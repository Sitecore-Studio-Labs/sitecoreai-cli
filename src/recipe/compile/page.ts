import { v5 as uuidv5 } from "uuid";
import { createScaiError } from "@/shared/errors";
import {
  contentItemId,
  datasourceId,
  fieldId,
  pageDesignId,
  pageItemId,
  renderingId,
  templateId,
  workflowId,
  workflowStateId,
} from "../items/guids";
import {
  type AddItemVersionOp,
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  LAYOUT_FIELDS,
  PAGE_DESIGN_FIELD_ID,
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import {
  type ContentFieldValue,
  type Layout,
  type PageRecipe,
  type PageRecipeParsed,
  PageRecipeSchema,
} from "../schema/recipe";
import { emitLayoutXml } from "../layout/emit";
import { encodeContentFieldValue } from "./content-item";
import {
  type CompileContext,
  type ImageMediaSink,
  joinPath,
  resolveMediaLocationFolder,
  sharedField,
  siteOf,
  versionedField,
} from "./shared";

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
 *    `__Final Renderings` so each language version sees the same layout.
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
export function compilePageRecipe(input: PageRecipe, context: CompileContext): OperationIr {
  const recipe = PageRecipeSchema.parse(input);

  // Simple (fields/translations) XOR story (versions) — never both. Zod
  // can't carry a refine on a discriminated-union member, so the compiler
  // enforces it.
  const isStory = recipe.versions !== undefined;
  if (isStory && (recipe.translations !== undefined || Object.keys(recipe.fields).length > 0)) {
    throw createScaiError(
      `PageRecipe '${recipe.handle}': a recipe is either simple (fields/translations) or a story (versions), not both.`,
      "INPUT_INVALID"
    );
  }
  if (isStory && recipe.layout !== undefined) {
    throw createScaiError(
      `PageRecipe '${recipe.handle}': item-level 'layout' is not allowed in story mode — declare layout on each versions[lang][n].layout entry instead.`,
      "INPUT_INVALID"
    );
  }

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
  }: {
    fields: Record<string, unknown>;
    language: string | undefined;
    version: number | undefined;
    labelTag: string;
    targetItemRefKey?: string;
    templateHandle?: string;
  }): void => {
    for (const [fieldName, rawValue] of Object.entries(fields)) {
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
  const emitLayout = (
    layout: Layout,
    language: string,
    version: number,
    labelTag: string
  ): void => {
    const layoutXml = emitLayoutXml(layout, {
      parentItemId: itemRefKey,
      deviceId: DEFAULT_DEVICE_ID,
      renderingIdFor: (handle) => renderingId(site, handle),
      contentItemIdFor: (handle) => contentItemId(site, handle),
      // A page has a content home — scoped placements resolve against
      // the `<page>/Data/<slot>` items materialised just above.
      allowScoped: true,
      scopedDatasourceIdFor: (slot) => datasourceId(itemRefKey, slot),
      mode: "canonical",
    });
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
  const dataFolderRefKey = datasourceId(itemRefKey, "Data");

  const emitters: PageEmitters = {
    recipe,
    policy,
    itemRefKey,
    versionOps,
    fieldOps,
    emitFields,
    emitLayout,
  };
  if (isStory) emitStoryVersions(emitters);
  else emitSimpleMode(emitters);

  // Compose: CreateItem → AddItemVersion…s → Data folder + scoped
  // slots → MediaUploads → SetFields → workflow. Scoped infrastructure
  // has to land BEFORE the layout SetFields so the captured-itemId map
  // carries the slot GUIDs `emitLayoutXml`'s `scopedDatasourceIdFor`
  // resolves.
  const operations: Operation[] = [createItem];
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
      templateOf: SITECORE_TEMPLATES.FOLDER,
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
      if (Object.keys(info.fields).length > 0) {
        emitFields({
          fields: info.fields,
          language: DEFAULT_LANGUAGE,
          version: DEFAULT_VERSION,
          labelTag: `scoped:${slot}`,
          targetItemRefKey: slotItemRefKey,
          templateHandle: datasourceTemplateHandle,
        });
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

/** One placement in a page layout (post-parse). */
type PagePlacement = Layout["placeholders"][string][number];

/**
 * Flatten every layout the recipe declares (item-level + per-version)
 * from the recursive authoring shape — placements hosting children in
 * `placement.placeholders` — into the flat SXA dynamic-placeholder wire
 * shape the rest of the compiler consumes:
 *
 *  - Each placement WITH children gets a page-unique integer
 *    `DynamicPlaceholderId` rendering parameter (author-set values are
 *    respected and never re-assigned; assigned ids skip any value an
 *    author already used). This is the parameter SXA Headless
 *    components read to construct their placeholder names.
 *  - Each child group keyed by a LOGICAL name (`column-1`) lands in the
 *    path-qualified concrete key
 *    `/<parent-placeholder-path>/<name>-<DynamicPlaceholderId>` — e.g.
 *    `/headless-main/column-1-1` — the key XM Cloud Pages writes when
 *    an author drops a component into a dynamic placeholder, so
 *    recipe-seeded and author-added children coexist in one layout.
 *
 * One id counter spans ALL of the recipe's layouts: ids are unique per
 * page item, mirroring SXA's per-page assignment, so per-version
 * layouts can never mint a key that collides with the item-level one.
 *
 * Mutates `recipe` in place (the object is the compiler's own
 * `PageRecipeSchema.parse` output, never the caller's input).
 */
const flattenRecipeLayouts = (recipe: PageRecipeParsed): void => {
  // Pre-scan author-set DynamicPlaceholderId values across every layout
  // so assigned ids never collide with them.
  const usedIds = new Set<string>();
  const scan = (placements: readonly PagePlacement[]): void => {
    for (const placement of placements) {
      const authored = placement.params?.DynamicPlaceholderId;
      if (authored) usedIds.add(authored);
      for (const children of Object.values(placement.placeholders ?? {})) scan(children);
    }
  };
  const layouts = collectRecipeLayouts(recipe);
  for (const layout of layouts) {
    for (const placements of Object.values(layout.placeholders)) scan(placements);
  }

  let nextId = 1;
  const takeId = (): string => {
    while (usedIds.has(String(nextId))) nextId += 1;
    const id = String(nextId);
    usedIds.add(id);
    return id;
  };

  const flattenLayout = (layout: Layout): Layout => {
    const out: Record<string, PagePlacement[]> = {};
    const emit = (key: string, placements: readonly PagePlacement[]): void => {
      const flat: PagePlacement[] = [];
      const childGroups: Array<{ key: string; placements: readonly PagePlacement[] }> = [];
      for (const placement of placements) {
        const { placeholders: children, ...rest } = placement;
        if (children && Object.keys(children).length > 0) {
          const dynamicPlaceholderId = rest.params?.DynamicPlaceholderId ?? takeId();
          flat.push({
            ...rest,
            params: { ...(rest.params ?? {}), DynamicPlaceholderId: dynamicPlaceholderId },
          });
          // Child keys are path-qualified against the parent's own
          // (already-concrete) key; the top level stays unqualified so
          // existing single-level layouts emit byte-identical XML.
          const parentPath = key.startsWith("/") ? key : `/${key}`;
          for (const [childName, childPlacements] of Object.entries(children)) {
            childGroups.push({
              key: `${parentPath}/${childName}-${dynamicPlaceholderId}`,
              placements: childPlacements,
            });
          }
        } else {
          flat.push(rest);
        }
      }
      out[key] = [...(out[key] ?? []), ...flat];
      for (const group of childGroups) emit(group.key, group.placements);
    };
    for (const [key, placements] of Object.entries(layout.placeholders)) emit(key, placements);
    return { placeholders: out };
  };

  if (recipe.layout) recipe.layout = flattenLayout(recipe.layout);
  if (recipe.versions) {
    for (const entries of Object.values(recipe.versions)) {
      for (const entry of entries) {
        if (entry.layout) entry.layout = flattenLayout(entry.layout);
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
}

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
 * language's `__Final Renderings` (per-language layout is story mode).
 */
const emitSimpleMode = (e: PageEmitters): void => {
  const { recipe } = e;
  e.emitFields({
    fields: recipe.fields,
    language: DEFAULT_LANGUAGE,
    version: DEFAULT_VERSION,
    labelTag: DEFAULT_LANGUAGE,
  });
  if (recipe.layout !== undefined) {
    e.emitLayout(recipe.layout, DEFAULT_LANGUAGE, DEFAULT_VERSION, DEFAULT_LANGUAGE);
  }
  for (const [language, translation] of Object.entries(recipe.translations ?? {})) {
    e.versionOps.push(addVersionOp(e, language, DEFAULT_VERSION));
    e.emitFields({
      fields: translation.fields,
      language,
      version: DEFAULT_VERSION,
      labelTag: language,
    });
    if (recipe.layout !== undefined) {
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

/**
 * Normalise a raw field value (registry flat shape OR scai-native
 * discriminated shape) to a `ContentFieldValue` for
 * `encodeContentFieldValue`. Returns `null` when the value is not
 * recognised (drops it from emission).
 *
 * Registry shape mapping:
 *  - string  → `{ shape: "text" }`
 *  - boolean → `{ shape: "boolean" }`
 *  - number  → `{ shape: "integer" }` when an integer, else `{ shape: "number" }`
 *  - object with `src`  → `{ shape: "image", mediaPath: src, alt?, width?, height? }`
 *  - object with `href` → `{ shape: "link-external", href, text?, target?, title? }`
 *  - object with `shape` → already a `ContentFieldValue`, pass through
 */
const normalizeFieldValue = (raw: unknown): ContentFieldValue | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return { shape: "text", value: raw };
  if (typeof raw === "boolean") return { shape: "boolean", value: raw };
  if (typeof raw === "number") {
    return Number.isInteger(raw)
      ? { shape: "integer", value: raw }
      : { shape: "number", value: raw };
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Already a scai-native discriminated ContentFieldValue.
    if (typeof obj.shape === "string") return obj as unknown as ContentFieldValue;
    // Registry image shape: { src, alt?, width?, height?, mediaLibraryFolder? }.
    if (typeof obj.src === "string") {
      return {
        shape: "image",
        mediaPath: obj.src,
        ...(typeof obj.alt === "string" ? { alt: obj.alt } : {}),
        ...(typeof obj.width === "number" ? { width: obj.width } : {}),
        ...(typeof obj.height === "number" ? { height: obj.height } : {}),
        ...(typeof obj.mediaLibraryFolder === "string"
          ? { mediaLibraryFolder: obj.mediaLibraryFolder }
          : {}),
      };
    }
    // Registry external-link shape: { href, text?, target?, title? }.
    if (typeof obj.href === "string") {
      return {
        shape: "link-external",
        href: obj.href,
        ...(typeof obj.text === "string" ? { text: obj.text } : {}),
        ...(typeof obj.target === "string" ? { target: obj.target } : {}),
        ...(typeof obj.title === "string" ? { title: obj.title } : {}),
      };
    }
  }
  return null;
};

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
