import { v5 as uuidv5 } from "@/shared/uuid";
import { createScaiError } from "@/shared/errors";
import {
  contentItemId,
  datasourceId,
  fieldId,
  itemPathRefKey,
  pageDesignId,
  pageItemId,
  renderingId,
  templateId,
  workflowId,
  workflowStateId,
} from "../items/guids";
import {
  type AddItemVersionOp,
  type AppendToMultiListOp,
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe, policyFor } from "../runtime/policy";
import {
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  LAYOUT_FIELDS,
  PAGE_DESIGN_FIELD_ID,
  SITECORE_TEMPLATE_PATHS,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import {
  type Layout,
  type PageRecipe,
  type PageRecipeParsed,
  PageRecipeSchema,
} from "../schema/recipe";
import { emitLayoutXml } from "../layout/emit";
import { encodeContentFieldValue } from "./content-item";
import { createLayoutFlattener } from "./flatten-layout";
import {
  isInlineChildArray,
  materializeInlineChildren,
  normalizeFieldValue,
} from "./inline-children";
import { layoutEncodingOptions } from "./layout-encoding";
import { type CompileContext, joinPath, sharedField, siteOf, versionedField } from "./shared";
import { type ImageMediaSink, resolveMediaLocationFolder } from "./media";

/**
 * Compile a `PageRecipe` to an Operation IR.
 *
 * A page is a concrete content-tree item conforming to a page template.
 * Mirrors `compileContentItemRecipe`'s mode model:
 *
 *  - **simple** (`fields` [+ `translations`]) — `SetField`s for the
 *    primary language at version 1; per translation language, an
 *    `AddItemVersion` that materialises the language version, plus its
 *    `SetField`s. Item-level `layout` is written to every language's
 *    `__Final Renderings` so each language version sees the same layout —
 *    or, with `layoutScope: "shared"`, ONCE to the item's `__Renderings`
 *    (Sitecore's Shared Layout) with no per-language copies.
 *  - **story** (`versions`) — per (language, numbered version): an
 *    `AddItemVersion` (except the default-language v1 the `CreateItem`
 *    already made) and that version's `SetField`s + per-version layout
 *    (`__Final Renderings`). Item-level `layout` is forbidden in story
 *    mode — the version-level layout is the only place layout can live.
 *
 * `storage: shared` fields (recipe.shared) are emitted with no
 * language/version. The two modes are mutually exclusive — `versions`
 * alongside `fields`/`translations` is rejected (`INPUT_INVALID`).
 *
 * Other ops in canonical order:
 *   1. `CreateItem` for the page item under `pagesRoot`, with
 *      `templateOf` pointing at the `PageTemplateRecipe`'s template.
 *   2. `CreateItem` for `<page>/Data` and one per `scoped` placement —
 *      page-local datasource items conforming to the placed component's
 *      datasource template. The scoped slot set is collected from
 *      every layout the recipe declares (item-level + per-version).
 *   3. `SetField(__Workflow)` — when `workflow` is set.
 *
 * Policy is `CreateOnly` (the `page-item` purpose): the registry seeds
 * the page, authors own it thereafter, and a re-push never overwrites
 * their edits.
 */
/**
 * RESILIENCE: drop scoped datasources placed on DATASOURCE-LESS renderings
 * (no `datasource.template`/`templates` and no inline `fields:` — e.g. a
 * layout `column-splitter` whose content lives in its placeholders). Such a
 * component has no template the slot item could conform to; the per-slot
 * fallback would set `templateOf = templateId(handle)`, a template nothing in
 * the set creates, and apply would abort the WHOLE install with a raw "Cannot
 * find a template" GraphQL error. Generated pages (page-compose) occasionally
 * emit this. Filtered BEFORE the layout XML is built so the rendering renders
 * WITHOUT a datasource (kind:none) and no orphan slot item is created. Mutates
 * `scopedSlots`. Only acts when the component is IN the set — an external
 * component we can't introspect is emitted as-is (unchanged behavior).
 */
const dropDatasourcelessScopedSlots = (
  scopedSlots: ReturnType<typeof collectScopedSlots>,
  recipeHandle: string,
  context: CompileContext
): void => {
  for (const [slot, info] of [...scopedSlots]) {
    const component = context.componentsByHandle?.get(info.componentHandle);
    if (
      component &&
      !component.datasource?.template?.handle &&
      !(component.datasource?.templates?.length ?? 0) &&
      !(component.fields?.length ?? 0)
    ) {
      context.onWarn?.(
        `page-datasource:${recipeHandle}:${slot} — component '${info.componentHandle}' is a ` +
          `datasource-less rendering (no datasource template or inline fields); dropping the scoped ` +
          `datasource. Author its content under the component's placeholders instead.`
      );
      scopedSlots.delete(slot);
    }
  }
};

export function compilePageRecipe(input: PageRecipe, context: CompileContext): OperationIr {
  const recipe = PageRecipeSchema.parse(input);

  // Simple (fields/translations) XOR story (versions) — never both. Zod
  // can't carry a refine on a discriminated-union member, so the compiler
  // enforces it.
  const isStory = recipe.versions !== undefined;
  if (isStory) assertStoryModeInvariants(recipe);

  // Flatten nested placements (layout components hosting children in
  // their own placeholders) into SXA dynamic-placeholder wire form
  // BEFORE anything walks the layouts — scoped-slot collection, insert
  // options, and layout emission all consume the flat shape.
  flattenRecipeLayouts(recipe);

  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const itemRefKey = pageItemId(site, recipe.handle);

  const { itemPath, parentPath, itemName } = resolvePagePath(recipe, context);

  const createItem: CreateItemOp = {
    op: "CreateItem",
    policy,
    label: `page:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: parentPath },
    // String GUID — resolves as a refKey when the page template ships in
    // the same set (`templateId(template)` is captured at apply time),
    // else as a literal Sitecore template GUID.
    templateOf: templateId(site, recipe.template),
    name: itemName,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
      // Per-page Page Design override — stamp the SXA `_Designable` facet's
      // `Page Design` Droplink (a shared field) at the page item so it
      // renders with the chosen design instead of the template's default.
      // `ref-recipe` because the page-design item is recipe-created; the
      // executor resolves its refKey to the real GUID at apply time.
      ...(recipe.pageDesign
        ? [
            sharedField(PAGE_DESIGN_FIELD_ID, {
              kind: "ref-recipe",
              refKey: pageDesignId(site, recipe.pageDesign),
            }),
          ]
        : []),
    ],
  };

  // AddItemVersion ops are emitted before SetFields so every per-version
  // SetField lands on a version that already exists.
  const versionOps: Operation[] = [];
  const fieldOps: Operation[] = [];
  // MediaUpload ops for external-URL image fields (page fields AND
  // datasource-item fields) — ordered before fieldOps in the final IR
  // so each media itemId is captured before the SetField whose
  // `media-xml-ref` references it resolves.
  // `mediaLocation` scope "page" mirrors this page's own directory: the
  // item path relative to `pagesRoot` becomes the media folder path.
  // Pages outside `pagesRoot` (explicit `itemPath` elsewhere) fall back
  // to the leaf name so the scope still yields a per-page folder.
  const pageRelativePath =
    context.pagesRoot && itemPath.startsWith(`${context.pagesRoot}/`)
      ? itemPath.slice(context.pagesRoot.length + 1)
      : itemName;
  const mediaLocationFolder = resolveMediaLocationFolder(recipe.mediaLocation, {
    context,
    site,
    recipeHandle: recipe.handle,
    pageRelativePath,
  });
  const imageMediaSink: ImageMediaSink = {
    policy,
    mediaOps: [],
    ...(context.mediaLibraryRoot ? { mediaLibraryRoot: context.mediaLibraryRoot } : {}),
    ...(context.imageDefaults ? { imageDefaults: context.imageDefaults } : {}),
    ...(mediaLocationFolder ? { locationFolder: mediaLocationFolder } : {}),
  };

  /**
   * Emit one SetField per field value at the given (language, version).
   *
   * Accepts either scai-native discriminated `ContentFieldValue`s or the
   * registry's flat shape (string, boolean, number, `{src, alt}`,
   * `{href, text}`) — normalised through `normalizeFieldValue` before
   * delegating to the shared `encodeContentFieldValue`.
   */
  const emitFields = ({
    fields,
    language,
    version,
    labelTag,
    targetItemRefKey = itemRefKey,
    templateHandle = recipe.template,
    inlineChildren,
  }: {
    fields: Record<string, unknown>;
    language: string | undefined;
    version: number | undefined;
    labelTag: string;
    targetItemRefKey?: string;
    templateHandle?: string;
    /**
     * Opt-in for inline treelist child materialisation — set by the
     * scoped-datasource call site only (children live under the slot
     * item; a page item's own fields have no sane child home).
     * `structureOps` receives the child `CreateItem` ops; the caller
     * must place them in the final IR BEFORE the fieldOps spread.
     */
    inlineChildren?: { parentPath: string; structureOps: Operation[] };
  }): void => {
    for (const [fieldName, rawValue] of Object.entries(fields)) {
      // Inline treelist child arrays: materialise real child items
      // under the datasource item and write the parent field as the
      // children's GUID list. Falls through to the legacy drop when
      // the child template can't be resolved.
      if (inlineChildren && isInlineChildArray(rawValue)) {
        const materialized = materializeInlineChildren({
          entries: rawValue,
          fieldName,
          parentItemRefKey: targetItemRefKey,
          parentItemPath: inlineChildren.parentPath,
          parentTemplateHandle: templateHandle,
          recipeHandle: recipe.handle,
          site,
          policy,
          context,
          labelPrefix: `page-inline:${recipe.handle}`,
          imageMedia: imageMediaSink,
        });
        if (materialized) {
          inlineChildren.structureOps.push(...materialized.createOps);
          fieldOps.push(...materialized.fieldOps);
          fieldOps.push({
            op: "SetField",
            policy,
            label: `page-field:${recipe.handle}:${labelTag}:${fieldName}`,
            itemRefKey: targetItemRefKey,
            fieldId: fieldId(site, templateHandle, fieldName),
            fieldName,
            ...(language !== undefined && { language }),
            ...(version !== undefined && { version }),
            value: materialized.parentValue,
          } satisfies SetFieldOp);
          continue;
        }
      }
      const normalised = normalizeFieldValue(rawValue);
      if (normalised === null) continue;
      const value = encodeContentFieldValue(normalised, recipe.handle, site, {
        fieldName,
        ...imageMediaSink,
      });
      fieldOps.push({
        op: "SetField",
        policy,
        label: `page-field:${recipe.handle}:${labelTag}:${fieldName}`,
        itemRefKey: targetItemRefKey,
        // Recipe-created field — Sitecore assigns its own GUID, so this
        // is an IR-internal refKey; the mutation resolves via `fieldName`.
        fieldId: fieldId(site, templateHandle, fieldName),
        fieldName,
        ...(language !== undefined && { language }),
        ...(version !== undefined && { version }),
        value,
      } satisfies SetFieldOp);
    }
  };

  /**
   * Emit a `__Final Renderings` SetField for the given (language, version)
   * cell. No-op when the layout has no placements after compile (keeps
   * round-trips clean — an empty layout doesn't write the field).
   */
  // Delta form — the wire shape XM Cloud Pages itself writes to
  // `__Final Renderings` on every author save (operator-verified
  // against multiple working tenant pages). The delta merges over the
  // page template's standard-values layout, which supplies the
  // `l="{JSON layout}"` device pointer; an earlier canonical
  // full-replace iteration had to carry `l` itself and still didn't
  // match what the Pages editor expects. No `<p:da name="l" />`
  // directive (deltaDeviceDirective: false) — Pages-authored page
  // deltas never carry it, and it would sever the inherited layout
  // pointer. Scoped datasources ride as `ds="local:/Data/<slot>"`
  // page-relative paths (no scopedDatasourceIdFor), matching both the
  // materialised `<page>/Data/<slot>` items and Pages' own convention.
  //
  // Extracted so the shared-layout transition clears can compute the
  // byte-exact XML the versioned path writes (their ownership guard).
  const versionedLayoutXml = (layout: Layout): string =>
    emitLayoutXml(layout, {
      parentItemId: itemRefKey,
      deviceId: DEFAULT_DEVICE_ID,
      renderingIdFor: (handle) => renderingId(site, handle),
      contentItemIdFor: (handle) => contentItemId(site, handle),
      allowScoped: true,
      mode: "delta",
      deltaDeviceDirective: false,
      // Encode variant selections + rendering params in the wire form Pages
      // reads back (variant → Variant Definition GUID; params → the field's
      // wire value). Shared with the partial/page-design compilers so all
      // three layout-holders encode identically.
      ...layoutEncodingOptions(site, context),
    });

  const emitLayout = (
    layout: Layout,
    language: string,
    version: number,
    labelTag: string
  ): void => {
    const layoutXml = versionedLayoutXml(layout);
    if (layoutXml.length === 0) return;
    fieldOps.push({
      op: "SetField",
      policy,
      label: `page-layout:${recipe.handle}:${labelTag}`,
      itemRefKey,
      fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
      language,
      version,
      value: { kind: "string", value: layoutXml },
    } satisfies SetFieldOp);
  };

  // Item-level `storage: shared` fields — one value, no language/version.
  // Mirrors `compileContentItemRecipe`.
  emitFields({
    fields: recipe.shared ?? {},
    language: undefined,
    version: undefined,
    labelTag: "shared",
  });

  // Scoped-slot collection runs across EVERY layout the recipe declares
  // (item-level + every per-version). The scoped Data folder + slot items
  // are materialised once — they're shared structure across (lang, version)
  // cells, not per-cell.
  const scopedSlots = collectScopedSlots(recipe);
  dropDatasourcelessScopedSlots(scopedSlots, recipe.handle, context);
  const dataFolderRefKey = datasourceId(itemRefKey, "Data");

  /**
   * Emit the item-level layout ONCE to the page's `__Renderings` —
   * Sitecore's SHARED layout, rendered identically by every language
   * version (`layoutScope: "shared"`). Same Pages-native delta form as
   * the versioned path: the shared layer merges over the template's
   * standard-values layout, and Pages author edits land in each
   * version's Final Layout on top of it.
   */
  // Extracted so the versioned-path transition clear can compute the
  // byte-exact XML the shared path writes (its ownership guard) — the
  // mirror of `versionedLayoutXml` above.
  const sharedLayoutXml = (layout: Layout): string =>
    emitLayoutXml(layout, {
      parentItemId: itemRefKey,
      deviceId: DEFAULT_DEVICE_ID,
      renderingIdFor: (handle) => renderingId(site, handle),
      contentItemIdFor: (handle) => contentItemId(site, handle),
      allowScoped: true,
      mode: "delta",
      deltaDeviceDirective: false,
      // The SHARED `__Renderings` wire form Pages itself writes:
      // anchor-less `<r>` elements (document order) + the root
      // `<p:da name="xsi" />` directive. The anchored partial-design
      // delta form fails to place against the (typically empty)
      // template standard-values base — operator-verified 2026-07-14
      // against a Pages-authored shared layout.
      deltaAnchors: false,
      deltaSharedForm: true,
      ...layoutEncodingOptions(site, context),
    });

  const emitSharedLayout = (layout: Layout): void => {
    const layoutXml = sharedLayoutXml(layout);
    if (layoutXml.length === 0) return;
    fieldOps.push({
      op: "SetField",
      policy,
      label: `page-layout:${recipe.handle}:shared`,
      itemRefKey,
      fieldId: LAYOUT_FIELDS.RENDERINGS,
      value: { kind: "string", value: layoutXml },
    } satisfies SetFieldOp);
  };

  /**
   * Transition ops for a page flipping versioned → shared: one guarded
   * clearing SetField per recipe-declared language's `__Final
   * Renderings`. An earlier push of this recipe with versioned scope
   * wrote the item-level layout into every declared language's Final
   * Layout; those per-language finals override the shared `__Renderings`
   * at render time, so without clearing them the flip is invisible. The
   * guard (`clearWhenEquivalentTo`) carries the exact XML the versioned
   * emission writes — the planner clears a language's final only while
   * it is still layout-equivalent to it (recipe-owned) and preserves
   * author-edited finals (see `planGuardedLayoutClear`).
   */
  const emitSharedLayoutTransitionClears = (layout: Layout): void => {
    const expected = versionedLayoutXml(layout);
    if (expected.length === 0) return;
    const languages = [...new Set([DEFAULT_LANGUAGE, ...Object.keys(recipe.translations ?? {})])];
    for (const language of languages) {
      fieldOps.push({
        op: "SetField",
        policy,
        label: `page-layout-clear-final:${recipe.handle}:${language}`,
        itemRefKey,
        fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
        language,
        version: DEFAULT_VERSION,
        value: { kind: "string", value: "" },
        clearWhenEquivalentTo: expected,
      } satisfies SetFieldOp);
    }
  };

  /**
   * Transition op for a page flipping shared → versioned — the mirror of
   * `emitSharedLayoutTransitionClears`. An earlier push of this recipe
   * with `layoutScope: "shared"` wrote the item-level layout into the
   * item's shared `__Renderings`; after the flip the per-language finals
   * carry the layout, and the stale shared layer would silently duplicate
   * every rendering underneath them (and resurface whenever a final is
   * cleared). One guarded clearing SetField removes exactly the
   * recipe-owned shared layout: the guard carries the byte-exact XML the
   * shared emission writes, so an author-written shared layout (or a
   * Pages no-op shell) is preserved (see `planGuardedLayoutClear`).
   */
  const emitVersionedLayoutTransitionClear = (layout: Layout): void => {
    const expected = sharedLayoutXml(layout);
    if (expected.length === 0) return;
    fieldOps.push({
      op: "SetField",
      policy,
      label: `page-layout-clear-shared:${recipe.handle}`,
      itemRefKey,
      fieldId: LAYOUT_FIELDS.RENDERINGS,
      value: { kind: "string", value: "" },
      clearWhenEquivalentTo: expected,
    } satisfies SetFieldOp);
  };

  const emitters: PageEmitters = {
    recipe,
    policy,
    itemRefKey,
    versionOps,
    fieldOps,
    emitFields,
    emitLayout,
    emitSharedLayout,
    emitSharedLayoutTransitionClears,
    emitVersionedLayoutTransitionClear,
  };
  if (isStory) emitStoryVersions(emitters);
  else emitSimpleMode(emitters);

  // Compose: CreateItem → AddItemVersion…s → Data folder + scoped
  // slots → MediaUploads → SetFields → workflow. Scoped infrastructure
  // has to land BEFORE the layout SetFields so the captured-itemId map
  // carries the slot GUIDs `emitLayoutXml`'s `scopedDatasourceIdFor`
  // resolves.
  const operations: Operation[] = [createItem];

  // Parent Insert Options: append this page's template to the PARENT
  // item's `__Masters` so authors can create more pages of the same
  // type in place — the Pages editor's "Create page (+)" flow lists
  // exactly the selected node's insert options, and without this the
  // installed page type never appears there. Item-level (not template
  // standard-values) because the parent usually conforms to a
  // tenant-owned template (the scaffolded collection Page) the recipe
  // set must not mutate. `merge-unique` keeps it additive + idempotent;
  // `latePath` resolves pre-existing parents the set doesn't create.
  operations.push({
    op: "AppendToMultiList",
    policy: policyFor("composition-structure"),
    label: `page-parent-insert-options:${recipe.handle}`,
    itemRefKey: itemPathRefKey(parentPath),
    latePath: parentPath,
    fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
    values: [{ kind: "ref-recipe", refKey: templateId(site, recipe.template) }],
    appendPolicy: "merge-unique",
  } satisfies AppendToMultiListOp);

  operations.push(...versionOps);
  if (scopedSlots.size > 0) {
    const dataFolderPath = joinPath(itemPath, "Data");
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `page-data-folder:${recipe.handle}`,
      id: dataFolderRefKey,
      path: dataFolderPath,
      parent: { kind: "ref-recipe", refKey: itemRefKey },
      // SXA's Page Data template — NOT the generic Common Folder — so
      // SXA/Pages recognise the folder as page-local datasource storage.
      templateOf: { kind: "ref-path", value: SITECORE_TEMPLATE_PATHS.SXA_PAGE_DATA },
      name: "Data",
      fields: [],
    } satisfies CreateItemOp);

    // Insert Options (`__Masters`) on the Data folder — the union of
    // datasource templates across EVERY rendering on the page (not just
    // scoped ones). Authors who turn off the rendering's `autoCreate`
    // — or who want to add an extra datasource later — see the right
    // set in the right-click → Insert menu. Without this, the Data
    // folder lands as a plain folder with no Insert Options, so the
    // menu is empty and authors have to use Raw API / hand-edit to
    // create a new datasource item.
    //
    // Resolution mirrors the per-slot `templateOf` path below + the
    // `RecipeDatasource` `templates[]` shape:
    //   1. component.datasource.templates[]  → all listed handles
    //   2. component.datasource.template     → single handle
    //   3. inline-`fields:` pattern          → component template itself
    // Deduped across placements so the same template GUID appears once.
    const insertOptionHandles = collectPageDataInsertOptions(recipe, context);
    if (insertOptionHandles.length > 0) {
      operations.push({
        op: "SetField",
        policy: "CreateOnly",
        label: `page-data-folder-insert-options:${recipe.handle}`,
        itemRefKey: dataFolderRefKey,
        fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
        value: {
          kind: "ref-recipe-list",
          refKeys: insertOptionHandles.map((handle) => templateId(site, handle)),
          // Standalone compile (no componentsByHandle) falls back to
          // resolving via the component handles themselves — those
          // refKeys land in the captured-itemId map when the
          // referenced templates' CreateItem ops run. In a single-
          // recipe push the referenced templates aren't part of the
          // set; tolerate so the data folder still gets created with
          // whatever Insert Options DID resolve.
          tolerateMissing: true,
        },
      } satisfies SetFieldOp);
    }

    for (const [slot, info] of scopedSlots) {
      // Resolve the component's datasource template, in precedence order:
      //   1. `datasource.template`     — single dedicated template.
      //   2. `datasource.templates[0]` — compatible-datasources pattern;
      //      the FIRST listed template is the component's primary
      //      datasource shape. CRITICAL: such components ship NO
      //      component-template item of their own (fields live on the
      //      content templates), so the component-handle fallback below
      //      would emit a refKey nothing in the set ever creates and the
      //      apply dies with a raw "Cannot find a template" GraphQL error.
      //   3. The component template itself — the inline-`fields:` pattern,
      //      and the only option for a standalone single-recipe compile.
      const component = context.componentsByHandle?.get(info.componentHandle);
      const datasourceTemplateHandle =
        component?.datasource?.template?.handle ??
        component?.datasource?.templates?.[0]?.handle ??
        info.componentHandle;
      const slotItemRefKey = datasourceId(itemRefKey, slot);
      operations.push({
        op: "CreateItem",
        policy,
        label: `page-datasource:${recipe.handle}:${slot}`,
        id: slotItemRefKey,
        path: joinPath(dataFolderPath, slot),
        parent: { kind: "ref-recipe", refKey: dataFolderRefKey },
        templateOf: templateId(site, datasourceTemplateHandle),
        name: slot,
        fields: [
          sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
          versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: slot }),
        ],
      } satisfies CreateItemOp);

      // Field values for the materialised `<page>/Data/<slot>` item.
      // Reuses the shared `emitFields` (which normalises both registry
      // flat shapes and scai-native discriminated values via
      // `encodeContentFieldValue`). Fields land on the slot item's own
      // refKey, scoped to that item's template for fieldId derivation.
      // Inline treelist child arrays materialise as REAL child items
      // under the slot item — their CreateItems land right here (after
      // the slot's own CreateItem, before the mediaOps/fieldOps spreads
      // below) so the parent field's ref-recipe-list resolves at apply.
      if (Object.keys(info.fields).length > 0) {
        const inlineChildOps: Operation[] = [];
        emitFields({
          fields: info.fields,
          language: DEFAULT_LANGUAGE,
          version: DEFAULT_VERSION,
          labelTag: `scoped:${slot}`,
          targetItemRefKey: slotItemRefKey,
          templateHandle: datasourceTemplateHandle,
          inlineChildren: {
            parentPath: joinPath(dataFolderPath, slot),
            structureOps: inlineChildOps,
          },
        });
        operations.push(...inlineChildOps);
      }
    }
  }
  // MediaUpload ops are spread AFTER the scoped-slots block: the
  // per-slot `emitFields` calls above push into `imageMediaSink.mediaOps`
  // too, and an earlier spread would copy the array before those land —
  // dropping the producer op and failing the scoped SetField's
  // `media-xml-ref` resolution at apply time ("refKey not in captured
  // map"). Uploads only need to precede the fieldOps that reference them.
  operations.push(...imageMediaSink.mediaOps);
  operations.push(...fieldOps);

  if (recipe.workflow) {
    operations.push({
      op: "SetField",
      policy,
      label: `page-workflow:${recipe.handle}`,
      itemRefKey,
      fieldId: deriveStandardFieldId(itemRefKey, "__Workflow"),
      fieldName: "__Workflow",
      value: { kind: "ref-recipe", refKey: workflowId(recipe.workflow) },
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/** The page item's resolved tenant path, parent path, and leaf name. */
interface PagePath {
  itemPath: string;
  parentPath: string;
  itemName: string;
}

/**
 * Flatten every layout the recipe declares (item-level + per-version)
 * from the recursive authoring shape into the flat SXA
 * dynamic-placeholder wire shape the rest of the compiler consumes —
 * see `./flatten-layout` for the key derivation. One id counter spans
 * ALL of the recipe's layouts: ids are unique per page item, mirroring
 * SXA's per-page assignment, so per-version layouts can never mint a
 * key that collides with the item-level one.
 *
 * Mutates `recipe` in place (the object is the compiler's own
 * `PageRecipeSchema.parse` output, never the caller's input).
 */
const flattenRecipeLayouts = (recipe: PageRecipeParsed): void => {
  const flatten = createLayoutFlattener(collectRecipeLayouts(recipe));
  if (recipe.layout) recipe.layout = flatten(recipe.layout);
  if (recipe.versions) {
    for (const entries of Object.values(recipe.versions)) {
      for (const entry of entries) {
        if (entry.layout) entry.layout = flatten(entry.layout);
      }
    }
  }
};

/** Every layout object the recipe declares (item-level + per-version). */
const collectRecipeLayouts = (recipe: PageRecipeParsed): Layout[] => {
  const layouts: Layout[] = [];
  if (recipe.layout) layouts.push(recipe.layout);
  for (const entries of Object.values(recipe.versions ?? {})) {
    for (const entry of entries) {
      if (entry.layout) layouts.push(entry.layout);
    }
  }
  return layouts;
};

/**
 * Resolve a page's tenant path. Explicit `itemPath` (registry shape)
 * wins — `{site}` is substituted with `context.sitePathSegment`
 * (`<siteCollection>/<siteName>`) so the page lands inside the real SXA
 * Headless site tree, and the page is parented at the path's parent
 * dir. Falls back to `pagesRoot + name` for legacy recipes without
 * `itemPath` (`pagesRoot` is required only in the fallback path).
 *
 * A `{site}` itemPath with no `sitePathSegment` configured throws
 * rather than substituting a fallback: the pre-fix behaviour reused the
 * GUID seed (`default` unless `siteScopedGuids` opted in), which
 * silently created pages under a phantom `/sitecore/content/default/`
 * tree no site serves.
 */
const resolvePagePath = (recipe: PageRecipeParsed, context: CompileContext): PagePath => {
  if (recipe.itemPath) {
    if (/\{site\}/.test(recipe.itemPath) && !context.sitePathSegment) {
      throw createScaiError(
        `PageRecipe '${recipe.handle}': itemPath '${recipe.itemPath}' uses the {site} placeholder but no site path is configured.`,
        "INPUT_INVALID",
        {
          hint: "Set `site` and `siteCollection` on the active envProfile in sitecoreai.cli.json (scai substitutes {site} with `<siteCollection>/<site>`), or author an explicit absolute itemPath.",
        }
      );
    }
    const itemPath = recipe.itemPath.replace(/\{site\}/g, context.sitePathSegment ?? "");
    const lastSlash = itemPath.lastIndexOf("/");
    return {
      itemPath,
      parentPath: itemPath.slice(0, lastSlash),
      itemName: itemPath.slice(lastSlash + 1),
    };
  }
  if (!context.pagesRoot) {
    throw createScaiError(
      `compilePageRecipe requires context.pagesRoot or an explicit \`itemPath\`; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID",
      {
        hint: "Set `pagesRoot` on the active envProfile in sitecoreai.cli.json — e.g. `/sitecore/content/<tenant>/<site>/Home` — or author `itemPath: '/sitecore/content/{site}/...'` on the recipe.",
      }
    );
  }
  return {
    itemPath: joinPath(context.pagesRoot, recipe.name),
    parentPath: context.pagesRoot,
    itemName: recipe.name,
  };
};

/**
 * The per-cell field/layout emit closures + the op accumulators they
 * write into, bundled so the two mode emitters (story / simple) can be
 * extracted out of `compilePageRecipe` without re-threading every
 * captured variable.
 */
interface PageEmitters {
  recipe: PageRecipeParsed;
  policy: ReturnType<typeof defaultPolicyForRecipe>;
  itemRefKey: string;
  versionOps: Operation[];
  fieldOps: Operation[];
  emitFields: (args: {
    fields: Record<string, unknown>;
    language: string | undefined;
    version: number | undefined;
    labelTag: string;
    targetItemRefKey?: string;
    templateHandle?: string;
  }) => void;
  emitLayout: (layout: Layout, language: string, version: number, labelTag: string) => void;
  /** Shared-layout emitter (`layoutScope: "shared"`) — one `__Renderings` write. */
  emitSharedLayout: (layout: Layout) => void;
  /**
   * Versioned → shared transition — guarded per-language
   * `__Final Renderings` clears (see `emitSharedLayoutTransitionClears`).
   */
  emitSharedLayoutTransitionClears: (layout: Layout) => void;
  /**
   * Shared → versioned transition — one guarded shared `__Renderings`
   * clear (see `emitVersionedLayoutTransitionClear`).
   */
  emitVersionedLayoutTransitionClear: (layout: Layout) => void;
}

/**
 * Story-mode input invariants (Zod can't carry a refine on a
 * discriminated-union member, so the compiler enforces them):
 * `versions` excludes `fields`/`translations`, item-level `layout`
 * (per-version layout is the only layout home), and
 * `layoutScope: "shared"` (per-version layouts are inherently
 * versioned).
 */
const assertStoryModeInvariants = (recipe: PageRecipeParsed): void => {
  if (recipe.translations !== undefined || Object.keys(recipe.fields).length > 0) {
    throw createScaiError(
      `PageRecipe '${recipe.handle}': a recipe is either simple (fields/translations) or a story (versions), not both.`,
      "INPUT_INVALID"
    );
  }
  if (recipe.layout !== undefined) {
    throw createScaiError(
      `PageRecipe '${recipe.handle}': item-level 'layout' is not allowed in story mode — declare layout on each versions[lang][n].layout entry instead.`,
      "INPUT_INVALID"
    );
  }
  if (recipe.layoutScope === "shared") {
    throw createScaiError(
      `PageRecipe '${recipe.handle}': layoutScope 'shared' is not allowed in story mode — per-version layouts are inherently versioned.`,
      "INPUT_INVALID"
    );
  }
};

/** One `AddItemVersion` op for a (language, version) cell. */
const addVersionOp = (e: PageEmitters, language: string, version: number): AddItemVersionOp => ({
  op: "AddItemVersion",
  policy: e.policy,
  label: `page-version:${e.recipe.handle}:${language}:${version}`,
  itemRefKey: e.itemRefKey,
  language,
  version,
});

/**
 * Emit one story-mode version cell — `AddItemVersion` (except the
 * default-language v1 the `CreateItem` already made), fields, optional
 * `__Workflow state` + `__Created` date, and per-version layout.
 */
const emitStoryVersionEntry = (
  e: PageEmitters,
  language: string,
  entry: NonNullable<PageRecipeParsed["versions"]>[string][number]
): void => {
  const { recipe, itemRefKey, policy } = e;
  if ((entry.variants?.length ?? 0) > 0) {
    throw createScaiError(
      `PageRecipe '${recipe.handle}': per-version personalization variants are not yet compiled.`,
      "INPUT_INVALID",
      { hint: "Author per-version fields, workflowState, date and layout for now." }
    );
  }
  if (!(language === DEFAULT_LANGUAGE && entry.version === DEFAULT_VERSION)) {
    e.versionOps.push(addVersionOp(e, language, entry.version));
  }
  const versionTag = `${language}.v${entry.version}`;
  e.emitFields({ fields: entry.fields, language, version: entry.version, labelTag: versionTag });

  if (entry.workflowState !== undefined) {
    // A workflow state can't exist without a workflow on the item.
    if (!recipe.workflow) {
      throw createScaiError(
        `PageRecipe '${recipe.handle}': version ${versionTag} sets workflowState ` +
          `'${entry.workflowState}' but the recipe has no \`workflow\`.`,
        "INPUT_INVALID",
        { hint: "Set the item-level `workflow` (a WorkflowRecipe handle) so the state resolves." }
      );
    }
    e.fieldOps.push({
      op: "SetField",
      policy,
      label: `page-workflow-state:${recipe.handle}:${versionTag}`,
      itemRefKey,
      fieldId: deriveStandardFieldId(itemRefKey, "__Workflow state"),
      fieldName: "__Workflow state",
      language,
      version: entry.version,
      value: { kind: "ref-recipe", refKey: workflowStateId(recipe.workflow, entry.workflowState) },
    } satisfies SetFieldOp);
  }
  if (entry.date !== undefined) {
    e.fieldOps.push({
      op: "SetField",
      policy,
      label: `page-version-date:${recipe.handle}:${versionTag}`,
      itemRefKey,
      fieldId: deriveStandardFieldId(itemRefKey, "__Created"),
      fieldName: "__Created",
      language,
      version: entry.version,
      value: { kind: "string", value: toSitecoreDate(entry.date, "datetime") },
    } satisfies SetFieldOp);
  }
  if (entry.layout !== undefined) {
    e.emitLayout(entry.layout, language, entry.version, versionTag);
  }
};

/** Story mode — emit every (language, numbered-version) cell, sorted by version. */
const emitStoryVersions = (e: PageEmitters): void => {
  for (const [language, entries] of Object.entries(e.recipe.versions ?? {})) {
    for (const entry of [...entries].sort((a, b) => a.version - b.version)) {
      emitStoryVersionEntry(e, language, entry);
    }
  }
};

/**
 * Simple mode — primary language at version 1, then a version per
 * translation language. The item-level `layout` lands on every
 * language's `__Final Renderings` (per-language layout is story mode),
 * or once on the shared `__Renderings` when `layoutScope: "shared"`.
 */
const emitSimpleMode = (e: PageEmitters): void => {
  const { recipe } = e;
  const sharedLayout = recipe.layoutScope === "shared";
  e.emitFields({
    fields: recipe.fields,
    language: DEFAULT_LANGUAGE,
    version: DEFAULT_VERSION,
    labelTag: DEFAULT_LANGUAGE,
  });
  if (recipe.layout !== undefined) {
    if (sharedLayout) {
      e.emitSharedLayout(recipe.layout);
      // Versioned → shared transition: an earlier versioned push wrote
      // this layout into every declared language's `__Final Renderings`,
      // which would override the shared layer at render time. Guarded
      // clears remove exactly those recipe-owned finals.
      e.emitSharedLayoutTransitionClears(recipe.layout);
    } else {
      e.emitLayout(recipe.layout, DEFAULT_LANGUAGE, DEFAULT_VERSION, DEFAULT_LANGUAGE);
      // Shared → versioned transition: an earlier shared push wrote this
      // layout into the item's shared `__Renderings`; the guarded clear
      // removes that recipe-owned shared layer so the page's layout
      // lives only in the (Pages-editable) per-language finals.
      e.emitVersionedLayoutTransitionClear(recipe.layout);
    }
  }
  for (const [language, translation] of Object.entries(recipe.translations ?? {})) {
    e.versionOps.push(addVersionOp(e, language, DEFAULT_VERSION));
    e.emitFields({
      fields: translation.fields,
      language,
      version: DEFAULT_VERSION,
      labelTag: language,
    });
    if (recipe.layout !== undefined && !sharedLayout) {
      e.emitLayout(recipe.layout, language, DEFAULT_VERSION, language);
    }
  }
};

/**
 * Format a recipe `date` (ISO `YYYY-MM-DD`) or `datetime` (ISO 8601 with
 * timezone) into Sitecore's stored format `yyyyMMddTHHmmssZ`. Mirrors
 * `toSitecoreDate` in `compile/content-item.ts` — declared separately to
 * keep the modules independent.
 */
const toSitecoreDate = (iso: string, kind: "date" | "datetime"): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw createScaiError(
      `ContentFieldValue ${kind}: '${iso}' is not a valid ISO date`,
      "INPUT_INVALID"
    );
  }
  if (kind === "date") {
    const isoDateOnly = iso.includes("T") ? iso.slice(0, 10) : iso;
    return `${isoDateOnly.replace(/-/g, "")}T000000Z`;
  }
  const yyyy = parsed.getUTCFullYear().toString().padStart(4, "0");
  const MM = (parsed.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = parsed.getUTCDate().toString().padStart(2, "0");
  const HH = parsed.getUTCHours().toString().padStart(2, "0");
  const mm = parsed.getUTCMinutes().toString().padStart(2, "0");
  const ss = parsed.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${MM}${dd}T${HH}${mm}${ss}Z`;
};

interface ScopedSlotInfo {
  /** Handle of the placed component — drives datasource-template fallback. */
  componentHandle: string;
  /**
   * Field values for the materialised `<page>/Data/<slot>` item, taken
   * from the first placement's `datasourceRef.scoped.fields` (first-seen
   * wins; the slot item is shared structure across (lang, version)
   * cells, so its field values are taken once).
   */
  fields: Record<string, unknown>;
}

/**
 * Collect the deduped `<slot, ScopedSlotInfo>` map across every layout
 * the recipe declares — item-level `layout` plus each `versions[lang][n]
 * .layout` cell. Order is first-seen for stable IR output.
 *
 * Scoped placements materialise page-local datasource items under
 * `<page>/Data/<slot>`. The slot items themselves are shared structure
 * (one Sitecore item per slot, regardless of how many `(lang, version)`
 * cells reference it), so this collection is union-of-layouts.
 */
const collectScopedSlots = (recipe: PageRecipeParsed): Map<string, ScopedSlotInfo> => {
  const slots = new Map<string, ScopedSlotInfo>();
  const addFrom = (layout: Layout): void => {
    for (const placements of Object.values(layout.placeholders)) {
      for (const placement of placements) {
        if (
          placement.datasourceRef?.kind === "scoped" &&
          !slots.has(placement.datasourceRef.slot)
        ) {
          slots.set(placement.datasourceRef.slot, {
            componentHandle: placement.componentHandle,
            fields: placement.datasourceRef.fields ?? {},
          });
        }
      }
    }
  };
  if (recipe.layout) addFrom(recipe.layout);
  if (recipe.versions) {
    for (const entries of Object.values(recipe.versions)) {
      for (const entry of entries) {
        if (entry.layout) addFrom(entry.layout);
      }
    }
  }
  return slots;
};

// `normalizeFieldValue` moved to `./inline-children` (the inline-child
// materialiser recursion needs it without a page-compiler dependency
// cycle). Re-exported here for back-compat with existing import paths.
export { normalizeFieldValue } from "./inline-children";

/**
 * Stable refKey for a Sitecore standard field on `itemRefKey`. Same
 * derivation as `compile/content-item.ts` — declared separately to keep
 * the modules independent.
 */
const STANDARD_FIELD_REFKEY_NAMESPACE = uuidv5(
  "standard-field",
  "d6c28e9f-21f3-56ee-ada3-f2a947c3d475" // NAMESPACE_ROOT
);
const deriveStandardFieldId = (parentRefKey: string, fieldName: string): string =>
  uuidv5(`${parentRefKey}:${fieldName}`, STANDARD_FIELD_REFKEY_NAMESPACE);

/**
 * Collect the deduped set of datasource template handles authors might
 * want to insert under a page's `Data` folder.
 *
 * Walks every placement on the page (not just scoped ones) and resolves
 * each component's datasource template handle via the same precedence as
 * the per-slot `templateOf`:
 *   1. `component.datasource.templates[]` — the compatible-datasources
 *      pattern; ALL listed handles contribute.
 *   2. `component.datasource.template` — single handle.
 *   3. Else (inline-`fields:` pattern, OR standalone compile with no
 *      `componentsByHandle` available) — the component template itself.
 *
 * Returns the union of handles in first-seen order, deduped. Result is
 * `[]` when no placements exist or every placement resolves to a
 * component the standalone compile can't see AND has no fallback
 * handle (which is structurally impossible — fallback is `componentHandle`
 * itself, always non-empty per `ComponentPlacementSchema`).
 */
const collectPageDataInsertOptions = (
  recipe: PageRecipeParsed,
  context: CompileContext
): readonly string[] => {
  if (!recipe.layout) return [];
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const placements of Object.values(recipe.layout.placeholders)) {
    for (const placement of placements) {
      const component = context.componentsByHandle?.get(placement.componentHandle);
      const candidateHandles: string[] = component?.datasource?.templates?.length
        ? component.datasource.templates.map((t) => t.handle)
        : component?.datasource?.template
          ? [component.datasource.template.handle]
          : // Fallback covers two cases: (1) inline-`fields:` pattern where
            // the component template IS the datasource template; (2) standalone
            // compile (no `componentsByHandle`) where we can't see the
            // component's `datasource` block at all. In both cases the
            // component handle resolves to the right templateId.
            [placement.componentHandle];
      for (const handle of candidateHandles) {
        if (seen.has(handle)) continue;
        seen.add(handle);
        handles.push(handle);
      }
    }
  }
  return handles;
};
