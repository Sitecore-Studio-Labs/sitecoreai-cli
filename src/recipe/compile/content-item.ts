import { v5 as uuidv5 } from "uuid";
import { createScaiError } from "@/shared/errors";
import {
  contentItemId,
  fieldId,
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
  type RefValue,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  LAYOUT_FIELDS,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { emitLayoutXml } from "../layout/emit";
import {
  type ContentFieldValue,
  type ContentItemRecipe,
  type ContentItemRecipeParsed,
  ContentItemRecipeSchema,
} from "../schema/recipe";
import {
  type CompileContext,
  externalImageMediaRef,
  type ImageMediaSink,
  isExternalMediaUrl,
  joinPath,
  resolveMediaLocationFolder,
  sharedField,
  siteOf,
  versionedField,
} from "./shared";

/**
 * Compile a `ContentItemRecipe` to an Operation IR.
 *
 * Emits a `CreateItem` for the item, then — by the recipe's mode:
 *
 *  - **simple** (`fields` [+ `translations`]) — `SetField`s for the primary
 *    language at version 1; per translation language, an `AddItemVersion`
 *    that materialises the language version, plus its `SetField`s.
 *  - **story** (`versions`) — per (language, numbered version): an
 *    `AddItemVersion` (except the default-language v1 the `CreateItem`
 *    already made) and that version's `SetField`s.
 *
 * `storage: shared` fields are emitted as `SetField`s with no
 * language/version. The two modes are mutually exclusive — `versions`
 * alongside `fields`/`translations` is rejected (`INPUT_INVALID`); Zod
 * can't express the XOR on a `discriminatedUnion` member, so the compiler
 * enforces it.
 *
 * Op order is `CreateItem → AddItemVersion…s → SetField…s` so every
 * per-version `SetField` lands on a version that already exists.
 *
 * The item's `templateOf` resolves via `templateId(templateType)` — the
 * corresponding template recipe must ship in the same set; the cross-recipe
 * validator (`validateRecipeSet`) catches a missing reference before push.
 * Field values dispatch on `shape` (see `encodeContentFieldValue`).
 *
 * Per-version `workflowState` resolves to a `__Workflow state` SetField
 * (against the item's `workflow`), `date` to a `__Created` SetField, and
 * `layout` to a `__Final Renderings` SetField.
 *
 * Known limitations (intentionally narrow surface; expand only when a
 * concrete story-recipe author asks for them):
 *  - **per-version `variants`** (personalization deltas) are not compiled
 *    — a recipe that sets them is rejected with a clear error rather
 *    than silently dropped. Needs a new RefValue + per-variant
 *    SetField shape.
 *  - **`link-internal`** is rejected at compile time — authors use
 *    `reference` (single-element `refs`) for Droplink-shaped fields,
 *    or `link-external` for URLs. Wiring needs a new RefValue kind
 *    for "General Link XML wrapping a refKey-resolved GUID."
 *  - **`image.mediaPath`** is an opaque path — no media-item upload.
 *    Recipes ship images by referencing existing media-library items,
 *    or by carrying a fully-qualified external URL (emitted as the
 *    image XML's `src` attribute so the Layout Service surfaces it —
 *    see `encodeImageXml`).
 */
/**
 * The per-(language, version) emit closures + op accumulators a story-mode
 * content item writes into, bundled so the per-version emission can be
 * extracted out of `compileContentItemRecipe`'s nested loop (keeps the loop
 * body shallow instead of nesting workflow/date/layout branches five deep).
 */
interface ContentItemStoryEmitters {
  recipe: ContentItemRecipeParsed;
  policy: ReturnType<typeof defaultPolicyForRecipe>;
  itemRefKey: string;
  site: string;
  versionOps: Operation[];
  fieldOps: Operation[];
  emitFields: (
    fields: Record<string, ContentFieldValue>,
    language: string | undefined,
    version: number | undefined,
    labelTag: string
  ) => void;
}

/** Append the per-version `__Workflow state` SetField when the entry sets one. */
const emitStoryWorkflowState = (
  e: ContentItemStoryEmitters,
  language: string,
  entry: NonNullable<ContentItemRecipeParsed["versions"]>[string][number],
  versionTag: string
): void => {
  if (entry.workflowState === undefined) return;
  const { recipe, policy, itemRefKey } = e;
  // A workflow state can't exist without a workflow on the item.
  if (!recipe.workflow) {
    throw createScaiError(
      `ContentItemRecipe '${recipe.handle}': version ${versionTag} sets workflowState ` +
        `'${entry.workflowState}' but the recipe has no \`workflow\`.`,
      "INPUT_INVALID",
      {
        hint: "Set the item-level `workflow` (a WorkflowRecipe handle) so the state resolves.",
      }
    );
  }
  e.fieldOps.push({
    op: "SetField",
    policy,
    label: `content-item-workflow-state:${recipe.handle}:${versionTag}`,
    itemRefKey,
    fieldId: deriveStandardFieldId(itemRefKey, "__Workflow state"),
    fieldName: "__Workflow state",
    language,
    version: entry.version,
    value: {
      kind: "ref-recipe",
      refKey: workflowStateId(recipe.workflow, entry.workflowState),
    },
  } satisfies SetFieldOp);
};

/** Append the per-version `__Final Renderings` SetField when the entry sets a layout. */
const emitStoryLayout = (
  e: ContentItemStoryEmitters,
  language: string,
  entry: NonNullable<ContentItemRecipeParsed["versions"]>[string][number],
  versionTag: string
): void => {
  if (entry.layout === undefined) return;
  const { recipe, policy, itemRefKey, site } = e;
  // A content item has no `Data` home, so scoped datasources are
  // disallowed — a version layout references shared datasources by handle.
  const layoutXml = emitLayoutXml(entry.layout, {
    parentItemId: itemRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: (handle) => renderingId(site, handle),
    contentItemIdFor: (handle) => contentItemId(site, handle),
    allowScoped: false,
    mode: "canonical",
  });
  if (layoutXml.length === 0) return;
  e.fieldOps.push({
    op: "SetField",
    policy,
    label: `content-item-layout:${recipe.handle}:${versionTag}`,
    itemRefKey,
    fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
    language,
    version: entry.version,
    value: { kind: "string", value: layoutXml },
  } satisfies SetFieldOp);
};

/**
 * Emit one story-mode (language, version) cell — `AddItemVersion` (except
 * the default-language v1 the `CreateItem` already made), fields, optional
 * `__Workflow state` + `__Created` date, and per-version layout.
 */
const emitStoryVersionEntry = (
  e: ContentItemStoryEmitters,
  language: string,
  entry: NonNullable<ContentItemRecipeParsed["versions"]>[string][number]
): void => {
  const { recipe, policy, itemRefKey } = e;
  if ((entry.variants?.length ?? 0) > 0) {
    throw createScaiError(
      `ContentItemRecipe '${recipe.handle}': per-version personalization variants are not yet compiled.`,
      "INPUT_INVALID",
      {
        hint: 'Author per-version fields, workflowState, date and layout for now — see docs/recipe-sync-architecture.md, "Content versioning — seeding a story".',
      }
    );
  }
  // `CreateItem` already made the default-language version 1; every
  // other (language, version) cell needs an explicit AddItemVersion.
  if (!(language === DEFAULT_LANGUAGE && entry.version === DEFAULT_VERSION)) {
    e.versionOps.push({
      op: "AddItemVersion",
      policy,
      label: `content-item-version:${recipe.handle}:${language}:${entry.version}`,
      itemRefKey,
      language,
      version: entry.version,
    } satisfies AddItemVersionOp);
  }
  const versionTag = `${language}.v${entry.version}`;
  e.emitFields(entry.fields, language, entry.version, versionTag);
  // The version's `__Workflow state` — resolved against the item's
  // workflow (a workflow state can't exist without a workflow).
  emitStoryWorkflowState(e, language, entry, versionTag);
  // The version's narrative date → `__Created`, backdating the
  // version so a seeded story's history reads true.
  if (entry.date !== undefined) {
    e.fieldOps.push({
      op: "SetField",
      policy,
      label: `content-item-version-date:${recipe.handle}:${versionTag}`,
      itemRefKey,
      fieldId: deriveStandardFieldId(itemRefKey, "__Created"),
      fieldName: "__Created",
      language,
      version: entry.version,
      value: { kind: "string", value: toSitecoreDate(entry.date, "datetime") },
    } satisfies SetFieldOp);
  }
  // The version's `__Final Renderings` (per-version layout).
  emitStoryLayout(e, language, entry, versionTag);
};

export function compileContentItemRecipe(
  input: ContentItemRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ContentItemRecipeSchema.parse(input);
  if (!context.contentItemsRoot) {
    throw createScaiError(
      `compileContentItemRecipe requires context.contentItemsRoot; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID"
    );
  }

  // Simple (fields/translations) XOR story (versions) — never both.
  const isStory = recipe.versions !== undefined;
  if (isStory && (recipe.translations !== undefined || Object.keys(recipe.fields).length > 0)) {
    throw createScaiError(
      `ContentItemRecipe '${recipe.handle}': a recipe is either simple (fields/translations) or a story (versions), not both.`,
      "INPUT_INVALID"
    );
  }

  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const itemRefKey = contentItemId(site, recipe.handle);
  const itemPath = joinPath(context.contentItemsRoot, recipe.name);
  const templateRefKey = templateId(site, recipe.templateType);

  const createItem: CreateItemOp = {
    op: "CreateItem",
    policy,
    label: `content-item:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.contentItemsRoot },
    // String GUID — the executor treats this as a refKey when it matches a
    // captured-itemId entry (the template recipe registers `templateId(handle)`),
    // else as a literal Sitecore template GUID.
    templateOf: templateRefKey,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  };

  // AddItemVersion ops are emitted before SetFields so every per-version
  // SetField lands on a version that already exists.
  const versionOps: Operation[] = [];
  const fieldOps: Operation[] = [];
  // MediaUpload ops for external-URL image fields — ordered before
  // fieldOps in the final IR so each media itemId is captured before the
  // SetField whose `media-xml-ref` references it resolves.
  // `mediaLocation` scope "page" is rejected here — a shared content
  // item has no host page to mirror (resolver throws INPUT_INVALID).
  const mediaLocationFolder = resolveMediaLocationFolder(recipe.mediaLocation, {
    context,
    site,
    recipeHandle: recipe.handle,
  });
  const imageMediaSink: ImageMediaSink = {
    policy,
    mediaOps: [],
    ...(context.mediaLibraryRoot ? { mediaLibraryRoot: context.mediaLibraryRoot } : {}),
    ...(context.imageDefaults ? { imageDefaults: context.imageDefaults } : {}),
    ...(mediaLocationFolder ? { locationFolder: mediaLocationFolder } : {}),
  };

  /** Emit one SetField per field value at the given (language, version). */
  const emitFields = (
    fields: Record<string, ContentFieldValue>,
    language: string | undefined,
    version: number | undefined,
    labelTag: string
  ): void => {
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      const value = encodeContentFieldValue(fieldValue, recipe.handle, site, {
        fieldName,
        ...imageMediaSink,
      });
      fieldOps.push({
        op: "SetField",
        policy,
        label: `content-item-field:${recipe.handle}:${labelTag}:${fieldName}`,
        itemRefKey,
        // Recipe-created field — Sitecore assigns the Template Field its own
        // GUID, so `fieldId` is only an IR-internal refKey; the mutation and
        // the planner's drift check resolve by `fieldName`.
        fieldId: fieldId(site, recipe.templateType, fieldName),
        fieldName,
        ...(language !== undefined && { language }),
        ...(version !== undefined && { version }),
        value,
      } satisfies SetFieldOp);
    }
  };

  // Item-level `storage: shared` fields — one value, no language/version.
  emitFields(recipe.shared ?? {}, undefined, undefined, "shared");

  if (isStory) {
    const storyEmitters: ContentItemStoryEmitters = {
      recipe,
      policy,
      itemRefKey,
      site,
      versionOps,
      fieldOps,
      emitFields,
    };
    for (const [language, entries] of Object.entries(recipe.versions ?? {})) {
      for (const entry of [...entries].sort((a, b) => a.version - b.version)) {
        emitStoryVersionEntry(storyEmitters, language, entry);
      }
    }
  } else {
    // Simple mode — primary language at version 1, then a version per
    // translation language.
    emitFields(recipe.fields, DEFAULT_LANGUAGE, DEFAULT_VERSION, DEFAULT_LANGUAGE);
    for (const [language, translation] of Object.entries(recipe.translations ?? {})) {
      versionOps.push({
        op: "AddItemVersion",
        policy,
        label: `content-item-version:${recipe.handle}:${language}:${DEFAULT_VERSION}`,
        itemRefKey,
        language,
        version: DEFAULT_VERSION,
      } satisfies AddItemVersionOp);
      emitFields(translation.fields, language, DEFAULT_VERSION, language);
    }
  }

  const operations: Operation[] = [
    createItem,
    ...imageMediaSink.mediaOps,
    ...versionOps,
    ...fieldOps,
  ];

  if (recipe.workflow) {
    operations.push({
      op: "SetField",
      policy,
      label: `content-item-workflow:${recipe.handle}`,
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

/**
 * Stable refKey for a Sitecore standard field on `itemRefKey`. Mirrors
 * the pattern in `compile/workflow.ts` — the canonical `fieldName` is
 * what the apply path uses for resolution, so `fieldId` only needs to
 * be a deterministic per-(item, field) refKey.
 */
const STANDARD_FIELD_REFKEY_NAMESPACE = uuidv5(
  "standard-field",
  "d6c28e9f-21f3-56ee-ada3-f2a947c3d475" // NAMESPACE_ROOT
);
const deriveStandardFieldId = (parentRefKey: string, fieldName: string): string =>
  uuidv5(`${parentRefKey}:${fieldName}`, STANDARD_FIELD_REFKEY_NAMESPACE);

/**
 * Format a recipe `date` (ISO `YYYY-MM-DD`) or `datetime` (ISO 8601 with
 * timezone) into Sitecore's stored format `yyyyMMddTHHmmssZ`.
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
    // Date-only — pin to UTC midnight to keep the output deterministic
    // regardless of host timezone.
    const isoDateOnly = iso.includes("T") ? iso.slice(0, 10) : iso;
    return `${isoDateOnly.replace(/-/g, "")}T000000Z`;
  }
  // Datetime: yyyyMMddTHHmmssZ in UTC.
  const yyyy = parsed.getUTCFullYear().toString().padStart(4, "0");
  const MM = (parsed.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = parsed.getUTCDate().toString().padStart(2, "0");
  const HH = parsed.getUTCHours().toString().padStart(2, "0");
  const mm = parsed.getUTCMinutes().toString().padStart(2, "0");
  const ss = parsed.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${MM}${dd}T${HH}${mm}${ss}Z`;
};

/**
 * Sitecore image-field XML. The attribute carrying `mediaPath` dispatches
 * on its shape:
 *
 *  - **Fully-qualified `http(s)` URL** → emitted as `src="…"`. This is
 *    the LEGACY fallback, taken only when the caller supplies no
 *    `ImageMediaSink` — the primary path materialises external URLs as
 *    real media items (MediaUpload + `media-xml-ref` →
 *    `<image mediaid="{GUID}" />`), because the Layout Service only
 *    builds a renderable `src` from `mediaid`; a bare `src=` attribute
 *    shows a thumbnail in Pages' field editor but never renders on the
 *    canvas or in head apps.
 *  - **Anything else** (a media-library path) → emitted as `mediapath="…"`
 *    — see `compileContentItemRecipe` JSDoc for the media-item upload
 *    caveat.
 */
const encodeImageXml = (img: {
  mediaPath: string;
  alt?: string;
  width?: number;
  height?: number;
}): string => {
  const pathAttr = isExternalMediaUrl(img.mediaPath) ? "src" : "mediapath";
  const attrs: string[] = [`${pathAttr}="${escapeXmlAttr(img.mediaPath)}"`];
  if (img.alt !== undefined) attrs.push(`alt="${escapeXmlAttr(img.alt)}"`);
  if (img.width !== undefined) attrs.push(`width="${img.width}"`);
  if (img.height !== undefined) attrs.push(`height="${img.height}"`);
  return `<image ${attrs.join(" ")} />`;
};

/**
 * Sitecore General Link XML for an external URL (`linktype="external"`).
 */
const encodeExternalLinkXml = (link: {
  href: string;
  text?: string;
  target?: string;
  title?: string;
}): string => {
  const attrs: string[] = [`linktype="external"`, `url="${escapeXmlAttr(link.href)}"`];
  if (link.text !== undefined) attrs.push(`text="${escapeXmlAttr(link.text)}"`);
  if (link.target !== undefined) attrs.push(`target="${escapeXmlAttr(link.target)}"`);
  if (link.title !== undefined) attrs.push(`title="${escapeXmlAttr(link.title)}"`);
  return `<link ${attrs.join(" ")} />`;
};

const escapeXmlAttr = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Encode one ContentFieldValue to a RefValue. Every supported shape
 * returns a RefValue; unsupported shapes (e.g. `link-internal`) throw
 * INPUT_INVALID at compile time — see the limitations docblock on
 * `compileContentItemRecipe`. Throws on truly invalid input.
 *
 * Exported so `compilePageRecipe` reuses the exact same field-value
 * encoding for page-item fields.
 *
 * `imageMedia` (fieldName + sink) opts external-URL image values into
 * media-item materialisation: a MediaUpload op lands in the sink and
 * the returned value is a `media-xml-ref` (resolved to
 * `<image mediaid="{GUID}" />` at apply). Without it, external URLs
 * fall back to the legacy `src=` XML — stored fine, but never rendered
 * by the Layout Service.
 */
export const encodeContentFieldValue = (
  value: ContentFieldValue,
  recipeHandle: string,
  site: string,
  imageMedia?: { fieldName: string } & ImageMediaSink
): RefValue => {
  switch (value.shape) {
    case "text":
    case "richText":
    case "enum":
      return { kind: "string", value: value.value };
    case "boolean":
      return { kind: "bool", value: value.value };
    case "number":
    case "integer":
      return { kind: "number", value: value.value };
    case "date":
    case "datetime":
      return { kind: "string", value: toSitecoreDate(value.value, value.shape) };
    case "image":
      if (imageMedia && isExternalMediaUrl(value.mediaPath)) {
        return externalImageMediaRef({
          site,
          recipeHandle,
          fieldName: imageMedia.fieldName,
          url: value.mediaPath,
          ...(value.alt ? { alt: value.alt } : {}),
          // Role is carried for provenance but substitution is NOT
          // opted into here: content values are AUTHORED — a page's
          // actual image must always win over the brand's role default
          // (which substitutes only into template Standard Values).
          ...(value.role ? { role: value.role } : {}),
          ...(value.mediaLibraryFolder ? { folder: value.mediaLibraryFolder } : {}),
          sink: imageMedia,
        });
      }
      return { kind: "string", value: encodeImageXml(value) };
    case "link-external":
      return { kind: "string", value: encodeExternalLinkXml(value) };
    case "link-internal":
      // Unsupported: needs a new RefValue kind for "General Link XML
      // wrapping a refKey-resolved GUID." Authors use `reference`
      // (single-element refs[]) for Droplink-shaped fields, or
      // `link-external` with an absolute URL.
      throw createScaiError(
        `ContentItemRecipe '${recipeHandle}': link-internal field shape is not yet supported. ` +
          `Use 'reference' shape with a single-element refs[] for Droplink/Reference fields, ` +
          `or 'link-external' with an absolute URL.`,
        "INPUT_INVALID"
      );
    case "reference":
      return {
        kind: "ref-recipe-list",
        refKeys: value.refs.map((handle) => contentItemId(site, handle)),
      };
  }
};
