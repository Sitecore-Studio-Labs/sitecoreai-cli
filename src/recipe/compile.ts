import {
  contentItemId,
  fieldId,
  PAGE_DESIGNS_ROOT_REF_KEY,
  pageDesignId,
  paramsFieldId,
  paramsSectionId,
  paramsTemplateId,
  partialDesignId,
  renderingId,
  sectionId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "./guids";
import {
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type PushPolicy,
  type RefValue,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "./ir/operations";
import { defaultPolicyForRecipe, policyFor } from "./policy";
import {
  COMPOSITION_FIELDS,
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  LAYOUT_FIELDS,
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "./ir/sitecore-templates";
import {
  type ComponentTemplateRecipe,
  ComponentTemplateRecipeSchema,
  type ContentFieldValue,
  type ContentItemRecipe,
  ContentItemRecipeSchema,
  type ContentTemplateRecipe,
  ContentTemplateRecipeSchema,
  type FieldDefinition,
  type PageDesignRecipe,
  PageDesignRecipeSchema,
  type ParamDefinition,
  type PartialDesignRecipe,
  PartialDesignRecipeSchema,
  type Recipe,
  RecipeSchema,
} from "./schema/recipe";
import {
  defaultSitecoreFieldType,
  type SitecoreFieldType,
  sitecoreFieldTypeLabel,
} from "./schema/field-types";
import { renderSourceFields, sourceFieldsNeedHandleResolution } from "./schema/source-fields";
import { emitLayoutXml } from "./layout/emit";
import { encodeTemplatesMapping } from "./layout/templates-mapping";

/**
 * Where a recipe's items land in the Sitecore content tree. Tenant-side
 * config — recipes themselves are tenant-agnostic. The compiler emits
 * deterministic Sitecore paths (`<templatesRoot>/<recipe.name>`, etc.)
 * that the executor resolves to server-assigned itemIds at runtime.
 */
export interface CompileContext {
  /** e.g. `/sitecore/templates/Project/<site>/Components`. */
  templatesRoot: string;
  /** e.g. `/sitecore/layout/Renderings/Project/<site>`. */
  renderingsRoot: string;
  /**
   * Phase 4: required for `PartialDesignRecipe` compilation. Where the
   * partial-design items land — typically
   * `/sitecore/content/<site>/Presentation/Partial Designs`.
   * Optional in the type so Phase 1 callers don't have to set it; the
   * partial-design compiler errors with a clear message if absent.
   */
  partialDesignsRoot?: string;
  /**
   * Phase 4: required for `PageDesignRecipe` compilation. Where the
   * page-design items land — typically
   * `/sitecore/content/<site>/Presentation/Page Designs`.
   *
   * The page-design compiler also emits a SetField op writing
   * `TemplatesMapping` on this root item itself. The executor resolves
   * the root item's GUID via a pre-seeded `crossRecipeRefs` entry the
   * orchestrator pipeline-step provides at runtime.
   */
  pageDesignsRoot?: string;
  /**
   * Phase 4: required for `ContentItemRecipe` compilation. Where shared
   * content items land — typically `/sitecore/content/<tenant>/<site>/Data`
   * or a sub-bucket for SXA sites. ContentItemRecipes encode `kind: "shared"`
   * datasource targets referenced from partial / page design layouts.
   */
  contentItemsRoot?: string;
}

const PARAMS_SECTION_NAME = "Parameters";
const DEFAULT_FIELDS_SECTION = "Content";
const VARIANTS_FOLDER_NAME = "Variants";

/**
 * Compiler-default `OtherProperties` on every emitted rendering. Recipe
 * `rendering.otherProperties` overrides keys here on a per-key basis.
 * `IsAutoDatasourceRendering` is true on every reference recipe (cta-button,
 * badge-block, card-block) — hoisted so authors don't repeat themselves.
 */
const DEFAULT_OTHER_PROPERTIES: Record<string, string> = {
  IsAutoDatasourceRendering: "true",
};

const joinPath = (parent: string, name: string): string => {
  const trimmed = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${trimmed}/${name}`;
};

/**
 * Compile a `ComponentTemplateRecipe` to an Operation IR.
 *
 * Pure: same recipe + same context → identical IR forever. The Authoring
 * API server-assigns itemIds on `createItem`, so the IR carries Sitecore
 * `path` fields for lookups + recipe-internal `refKey` GUIDs (uuidv5)
 * which the executor uses as the key into a per-run captured-itemId map.
 *
 * Op order is fixed so the IR is reviewable:
 *
 *   datasource template
 *     1. CreateItem(template)                    parent=templatesRoot path
 *     2. SetBaseTemplates(template) → Standard Template
 *     3. CreateItem(section)                     parent=template (ref-recipe)
 *     4. CreateItem(field)                       parent=section
 *     5. CreateItem(__Standard Values)           parent=template; templateOf=template's id
 *     6. SetStandardValues(template, sv)
 *
 *   parameters template (only when recipe.params is non-empty)
 *     7. CreateItem(params-template)
 *     8. SetBaseTemplates(params-template)
 *     9. CreateItem(params-section)
 *    10. CreateItem(params-field)
 *
 *   rendering and SXA Rendering Variants
 *    11. CreateItem(rendering)                   carries Parameters Template ref-recipe
 *    12. CreateItem(variants-folder)             only when recipe.variants is non-empty
 *    13. CreateItem(variant)
 */
export function compileComponentTemplateRecipe(
  input: ComponentTemplateRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ComponentTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const icon = DEFAULT_ICON;

  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
    },
    context,
    icon,
    policy
  );

  const hasParams = recipe.params.length > 0;
  if (hasParams) {
    emitParamsTemplate(operations, recipe, context, icon, policy);
  }

  emitRendering(operations, recipe, context, icon, hasParams, policy);

  if (recipe.variants.length > 0) {
    emitVariants(operations, recipe, context, icon, policy);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `ContentTemplateRecipe` to an Operation IR.
 *
 * Content templates are data-only: a Sitecore template + sections + fields
 * + standard values + back-fill. No rendering, no params, no variants.
 */
export function compileContentTemplateRecipe(
  input: ContentTemplateRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ContentTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];

  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
    },
    context,
    DEFAULT_ICON,
    defaultPolicyForRecipe(recipe.kind)
  );

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `PartialDesignRecipe` to an Operation IR.
 *
 * Emits two ops:
 *   1. `CreateItem` for the partial-design item (SXA Partial Design template)
 *   2. `SetField` writing the layout XML to `__Renderings` (shared layout)
 *
 * The compiler resolves component / content-item handles in the layout
 * to deterministic GUIDs at compile time — no executor-side handle
 * resolution required for the layout body. (Page-template handles in
 * `appliesTo` and partial handles in `partials[]` on `PageDesignRecipe`
 * resolve the same way.)
 */
export function compilePartialDesignRecipe(
  input: PartialDesignRecipe,
  context: CompileContext
): OperationIr {
  const recipe = PartialDesignRecipeSchema.parse(input);
  if (!context.partialDesignsRoot) {
    throw new Error(
      `compilePartialDesignRecipe requires context.partialDesignsRoot; tenant-side path missing for recipe ${recipe.handle}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = partialDesignId(recipe.handle);
  const itemPath = joinPath(context.partialDesignsRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `partial-design:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.partialDesignsRoot },
    templateOf: SITECORE_TEMPLATES.PARTIAL_DESIGN,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  const layoutXml = emitLayoutXml(recipe.layout, {
    parentItemId: itemRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: renderingId,
    contentItemIdFor: contentItemId,
    allowScoped: false,
    // SXA Partial Design's Layout pipeline normalizes canonical input
    // into delta form on first write — emit delta directly so first
    // push converges in one cycle (commit 6404024 documented the
    // two-cycle workaround; this is its Phase 5 follow-up).
    mode: "delta",
  });

  if (layoutXml.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `partial-design-layout:${recipe.handle}`,
      itemRefKey,
      fieldId: LAYOUT_FIELDS.RENDERINGS,
      value: { kind: "string", value: layoutXml },
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `PageDesignRecipe` to an Operation IR.
 *
 * Emits up to three ops:
 *   1. `CreateItem` for the page-design item (SXA Page Design template)
 *   2. `SetField(PartialDesigns)` — pipe-separated GUID list of partials
 *   3. `SetField(__Renderings)` — only when recipe.layout is non-empty
 *
 * The recipe's `appliesTo` contributions to the Page Designs root's
 * `TemplatesMapping` field are NOT emitted here — that field is
 * cross-recipe (every page design contributes a slice) and a per-recipe
 * `kind: "string"` write would full-replace under the executor's write
 * semantics, with each page design overwriting its siblings. Use
 * `compileRecipeSet` (below) to compile a coherent set of recipes —
 * it aggregates `appliesTo` contributions across every page-design
 * recipe in the set into one combined IR.
 */
export function compilePageDesignRecipe(
  input: PageDesignRecipe,
  context: CompileContext
): OperationIr {
  const recipe = PageDesignRecipeSchema.parse(input);
  if (!context.pageDesignsRoot) {
    throw new Error(
      `compilePageDesignRecipe requires context.pageDesignsRoot; tenant-side path missing for recipe ${recipe.handle}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = pageDesignId(recipe.handle);
  const itemPath = joinPath(context.pageDesignsRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `page-design:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.pageDesignsRoot },
    templateOf: SITECORE_TEMPLATES.PAGE_DESIGN,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  if (recipe.partials.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `page-design-partials:${recipe.handle}`,
      itemRefKey,
      fieldId: COMPOSITION_FIELDS.PARTIAL_DESIGNS,
      value: {
        kind: "ref-recipe-list",
        refKeys: recipe.partials.map((handle) => partialDesignId(handle)),
      },
    } satisfies SetFieldOp);
  }

  if (recipe.layout && Object.keys(recipe.layout.placeholders).length > 0) {
    const layoutXml = emitLayoutXml(recipe.layout, {
      parentItemId: itemRefKey,
      deviceId: DEFAULT_DEVICE_ID,
      renderingIdFor: renderingId,
      contentItemIdFor: contentItemId,
      allowScoped: false,
      // Page Design preserves canonical input on read-back — keep emitting
      // canonical so the layout XML round-trips byte-for-byte.
      mode: "canonical",
    });
    if (layoutXml.length > 0) {
      operations.push({
        op: "SetField",
        policy,
        label: `page-design-layout:${recipe.handle}`,
        itemRefKey,
        fieldId: LAYOUT_FIELDS.RENDERINGS,
        value: { kind: "string", value: layoutXml },
      } satisfies SetFieldOp);
    }
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `ContentItemRecipe` to an Operation IR.
 *
 * Emits one `CreateItem` for the content item plus one `SetField` per
 * field value. The item's `templateOf` resolves via `templateId(templateType)`
 * — the corresponding `ContentTemplateRecipe` (or `ComponentTemplateRecipe`)
 * must ship in the same set so the executor's captured-itemId map carries
 * its server-assigned GUID at apply time. The cross-recipe validator
 * (`validateRecipeSet`) catches missing template references before push.
 *
 * Field values dispatch on `shape` to one of the encoders below. Most
 * shapes encode at compile time to a `kind: "string"` value (Sitecore's
 * stored representation is always a string); `reference` shapes emit
 * `kind: "ref-recipe-list"` so the executor substitutes captured itemIds
 * at apply time.
 *
 * Phase 4 v1 limitations:
 *  - `link-internal` is deferred — the wire format is XML wrapping a
 *    refKey-resolved GUID, which requires a new RefValue kind. Authors
 *    should use `reference` (with a single-element `refs` array) for
 *    Droplink/Reference fields, or `link-external` for external URLs.
 *  - `image.mediaPath` is treated as an opaque path — no media-item
 *    upload. Sitecore renders the field if a media library item exists
 *    at that path; otherwise the field is empty until media seeding
 *    lands in Phase 5+.
 */
export function compileContentItemRecipe(
  input: ContentItemRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ContentItemRecipeSchema.parse(input);
  if (!context.contentItemsRoot) {
    throw new Error(
      `compileContentItemRecipe requires context.contentItemsRoot; tenant-side path missing for recipe ${recipe.handle}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = contentItemId(recipe.handle);
  const itemPath = joinPath(context.contentItemsRoot, recipe.name);
  const templateRefKey = templateId(recipe.templateType);

  operations.push({
    op: "CreateItem",
    policy,
    label: `content-item:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.contentItemsRoot },
    // String GUID — the executor treats this as a refKey when it matches a
    // captured-itemId entry (the ContentTemplateRecipe / ComponentTemplateRecipe
    // for `recipe.templateType` registers `templateId(handle)` at apply
    // time), else as a literal Sitecore template GUID.
    templateOf: templateRefKey,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  for (const [fieldName, fieldValue] of Object.entries(recipe.fields)) {
    const value = encodeContentFieldValue(fieldValue, recipe.handle);
    if (value === null) continue;
    const fieldGuid = fieldId(recipe.templateType, fieldName);
    operations.push({
      op: "SetField",
      policy,
      label: `content-item-field:${recipe.handle}:${fieldName}`,
      itemRefKey,
      fieldId: fieldGuid,
      // Recipe-created field — Sitecore assigns its own GUID to the
      // Template Field item, so fieldGuid is only an IR-internal refKey.
      // The mutation needs the human-readable name; planner uses it for
      // diff matching against the remote item's field-by-name.
      fieldName,
      // Versioned: content-item field values are language/version-scoped.
      // Default language/version are filled in by versionedField helper —
      // duplicating its shape here so the SetField op carries them.
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value,
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Format a recipe `date` (ISO `YYYY-MM-DD`) or `datetime` (ISO 8601 with
 * timezone) into Sitecore's stored format `yyyyMMddTHHmmssZ`.
 */
const toSitecoreDate = (iso: string, kind: "date" | "datetime"): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`ContentFieldValue ${kind}: '${iso}' is not a valid ISO date`);
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
 * Sitecore image-field XML. Phase 4 v1 emits `mediapath` only — see
 * `compileContentItemRecipe` JSDoc for the media-item upload caveat.
 */
const encodeImageXml = (img: {
  mediaPath: string;
  alt?: string;
  width?: number;
  height?: number;
}): string => {
  const attrs: string[] = [`mediapath="${escapeXmlAttr(img.mediaPath)}"`];
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
 * Encode one ContentFieldValue to a RefValue. Returns null when the
 * shape is deferred (e.g. `link-internal` in Phase 4 v1) — the caller
 * skips emitting a SetField op for it. Throws on truly invalid input.
 */
const encodeContentFieldValue = (
  value: ContentFieldValue,
  recipeHandle: string
): RefValue | null => {
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
      return { kind: "string", value: encodeImageXml(value) };
    case "link-external":
      return { kind: "string", value: encodeExternalLinkXml(value) };
    case "link-internal":
      // Deferred: General Link XML wrapping a refKey-resolved GUID needs
      // a new RefValue kind. Recipe authors targeting Phase 4 should use
      // `reference` (single-element refs[]) for Droplink-shaped fields.
      throw new Error(
        `ContentItemRecipe '${recipeHandle}': link-internal is deferred to Phase 5. ` +
          `Use 'reference' shape with a single-element refs[] for Droplink/Reference fields, ` +
          `or 'link-external' with an absolute URL for now.`
      );
    case "reference":
      return {
        kind: "ref-recipe-list",
        refKeys: value.refs.map((handle) => contentItemId(handle)),
      };
  }
};

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to write
 * the cross-recipe `TemplatesMapping` aggregate. Not a real recipe — the
 * leading double-underscore signals "compiler-synthesized" and avoids
 * collision with any author-defined handle (recipe handles match
 * `[a-z][a-z0-9-]*@\d+`, so a leading underscore is unrepresentable).
 */
export const TEMPLATES_MAPPING_AGGREGATE_HANDLE = "__templates-mapping__";

/**
 * Compile a coherent set of recipes to a list of Operation IRs.
 *
 * Returns one IR per recipe (via `compileRecipe`), plus, when any
 * `PageDesignRecipe` in the set declares `appliesTo`, a final synthetic
 * IR whose only op is the combined `SetField(TemplatesMapping)` write
 * on the Page Designs root.
 *
 * The TemplatesMapping field is cross-recipe by nature — every page
 * design contributes one entry per applies-to template, and the field
 * stores the union. Aggregating at compile time keeps the executor
 * untouched (one full-replace write of the union) and gives reviewers
 * a single combined op to inspect rather than N piecewise overwrites.
 *
 * Entries are sorted by `templateGuid` for deterministic output — the
 * IR is the comparable artifact, so order must not depend on input
 * recipe order. Within a single applies-to template, "last design
 * wins" is enforced by sorting (later entries with the same key
 * overwrite earlier ones), but that's a pathological config the
 * cross-recipe validator should already flag.
 */
export function compileRecipeSet(
  recipes: readonly Recipe[],
  context: CompileContext
): OperationIr[] {
  const irs: OperationIr[] = recipes.map((recipe) => compileRecipe(recipe, context));

  const entries: { templateGuid: string; designGuid: string }[] = [];
  for (const recipe of recipes) {
    if (recipe.kind !== "page-design") continue;
    if (recipe.appliesTo.length === 0) continue;
    const designGuid = pageDesignId(recipe.handle);
    for (const tplHandle of recipe.appliesTo) {
      entries.push({ templateGuid: templateId(tplHandle), designGuid });
    }
  }

  if (entries.length === 0) {
    return irs;
  }

  entries.sort((a, b) =>
    a.templateGuid === b.templateGuid
      ? a.designGuid.localeCompare(b.designGuid)
      : a.templateGuid.localeCompare(b.templateGuid)
  );

  const aggregateOp: SetFieldOp = {
    op: "SetField",
    policy: policyFor("composition-structure"),
    label: "templates-mapping:aggregate",
    itemRefKey: PAGE_DESIGNS_ROOT_REF_KEY,
    fieldId: COMPOSITION_FIELDS.TEMPLATES_MAPPING,
    value: { kind: "string", value: encodeTemplatesMapping(entries) },
  };

  irs.push(
    OperationIrSchema.parse({
      schemaVersion: "1",
      recipeHandle: TEMPLATES_MAPPING_AGGREGATE_HANDLE,
      operations: [aggregateOp],
    })
  );

  return irs;
}

/** Front-door dispatcher — accepts any registered recipe kind. */
export function compileRecipe(input: Recipe, context: CompileContext): OperationIr {
  const recipe = RecipeSchema.parse(input);
  switch (recipe.kind) {
    case "component-template":
      return compileComponentTemplateRecipe(recipe, context);
    case "content-template":
      return compileContentTemplateRecipe(recipe, context);
    case "content-item":
      return compileContentItemRecipe(recipe, context);
    case "partial-design":
      return compilePartialDesignRecipe(recipe, context);
    case "page-design":
      return compilePageDesignRecipe(recipe, context);
  }
}

interface DatasourceTemplateInput {
  handle: string;
  name: string;
  displayName: string;
  fields: FieldDefinition[];
  insertOptions?: string[];
}

function emitDatasourceTemplate(
  operations: Operation[],
  recipe: DatasourceTemplateInput,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const tplRefKey = templateId(recipe.handle);
  const tplPath = joinPath(context.templatesRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `template:${recipe.handle}`,
    id: tplRefKey,
    path: tplPath,
    parent: { kind: "ref-path", value: context.templatesRoot },
    templateOf: SITECORE_TEMPLATES.TEMPLATE,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetBaseTemplates",
    policy,
    label: `base-templates:${recipe.handle}`,
    itemRefKey: tplRefKey,
    baseTemplates: [STANDARD_TEMPLATE_ID],
  } satisfies SetBaseTemplatesOp);

  for (const group of groupFieldsBySection(recipe.fields)) {
    const secRefKey = sectionId(recipe.handle, group.section);
    const secPath = joinPath(tplPath, group.section);
    operations.push({
      op: "CreateItem",
      policy,
      label: `section:${recipe.handle}/${group.section}`,
      id: secRefKey,
      path: secPath,
      parent: { kind: "ref-recipe", refKey: tplRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      name: group.section,
      fields: [],
    } satisfies CreateItemOp);

    group.fields.forEach((field, index) => {
      operations.push(
        buildFieldOp({
          recipeHandle: recipe.handle,
          fieldRefKey: fieldId(recipe.handle, field.name),
          fieldPath: joinPath(secPath, field.name),
          parentRefKey: secRefKey,
          labelPrefix: `field:${recipe.handle}`,
          field,
          zeroBasedIndex: index,
          policy,
        })
      );
    });
  }

  const svRefKey = standardValuesId(recipe.handle);
  const svPath = joinPath(tplPath, "__Standard Values");
  operations.push({
    op: "CreateItem",
    policy,
    label: `standard-values:${recipe.handle}`,
    id: svRefKey,
    path: svPath,
    parent: { kind: "ref-recipe", refKey: tplRefKey },
    // The SV item conforms to the template we just created — runtime
    // resolution turns this ref-recipe placeholder into the assigned id.
    templateOf: tplRefKey,
    name: "__Standard Values",
    fields: [],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetStandardValues",
    policy,
    label: `link-standard-values:${recipe.handle}`,
    templateRefKey: tplRefKey,
    standardValuesRefKey: svRefKey,
  } satisfies SetStandardValuesOp);

  if (recipe.insertOptions && recipe.insertOptions.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `insert-options:${recipe.handle}`,
      itemRefKey: svRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: recipe.insertOptions.map((handle) => templateId(handle)),
      },
    } satisfies SetFieldOp);
  }
}

function emitParamsTemplate(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const paramsTplRefKey = paramsTemplateId(recipe.handle);
  const paramsName = `${recipe.name} Parameters`;
  const paramsDisplayName = `${recipe.displayName} Parameters`;
  const paramsTplPath = joinPath(context.templatesRoot, paramsName);

  operations.push({
    op: "CreateItem",
    policy,
    label: `params-template:${recipe.handle}`,
    id: paramsTplRefKey,
    path: paramsTplPath,
    parent: { kind: "ref-path", value: context.templatesRoot },
    templateOf: SITECORE_TEMPLATES.TEMPLATE,
    name: paramsName,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: paramsDisplayName }),
    ],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetBaseTemplates",
    policy,
    label: `params-base-templates:${recipe.handle}`,
    itemRefKey: paramsTplRefKey,
    baseTemplates: [STANDARD_TEMPLATE_ID],
  } satisfies SetBaseTemplatesOp);

  const paramsSecRefKey = paramsSectionId(recipe.handle, PARAMS_SECTION_NAME);
  const paramsSecPath = joinPath(paramsTplPath, PARAMS_SECTION_NAME);
  operations.push({
    op: "CreateItem",
    policy,
    label: `params-section:${recipe.handle}/${PARAMS_SECTION_NAME}`,
    id: paramsSecRefKey,
    path: paramsSecPath,
    parent: { kind: "ref-recipe", refKey: paramsTplRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
    name: PARAMS_SECTION_NAME,
    fields: [],
  } satisfies CreateItemOp);

  recipe.params.forEach((param, index) => {
    operations.push(
      buildFieldOp({
        recipeHandle: recipe.handle,
        fieldRefKey: paramsFieldId(recipe.handle, param.name),
        fieldPath: joinPath(paramsSecPath, param.name),
        parentRefKey: paramsSecRefKey,
        labelPrefix: `params-field:${recipe.handle}`,
        field: param,
        zeroBasedIndex: index,
        policy,
      })
    );
  });
}

function emitRendering(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  hasParams: boolean,
  policy: PushPolicy
): void {
  const renderingRefKey = renderingId(recipe.handle);
  const renderingPath = joinPath(context.renderingsRoot, recipe.name);
  const tplRefKey = templateId(recipe.handle);

  const fields: FieldValue[] = [
    sharedField(RENDERING_FIELDS.COMPONENT_NAME, { kind: "string", value: recipe.name }),
    sharedField(RENDERING_FIELDS.DATASOURCE_TEMPLATE, {
      kind: "ref-recipe",
      refKey: tplRefKey,
    }),
    sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
  ];

  if (hasParams) {
    fields.push(
      sharedField(RENDERING_FIELDS.PARAMETERS_TEMPLATE, {
        kind: "ref-recipe",
        refKey: paramsTemplateId(recipe.handle),
      })
    );
  }

  if (recipe.rendering.datasourceLocation === "query" && recipe.rendering.datasourceLocationQuery) {
    fields.push(
      sharedField(RENDERING_FIELDS.DATASOURCE_LOCATION, {
        kind: "query",
        value: recipe.rendering.datasourceLocationQuery,
      })
    );
  } else if (recipe.rendering.datasourceLocation === "current-item") {
    fields.push(sharedField(RENDERING_FIELDS.DATASOURCE_LOCATION, { kind: "string", value: "." }));
  }

  fields.push(
    sharedField(RENDERING_FIELDS.OPEN_PROPERTIES_AFTER_ADD, {
      kind: "bool",
      value: recipe.rendering.openPropertiesAfterAdd,
    })
  );

  const otherProperties = {
    ...DEFAULT_OTHER_PROPERTIES,
    ...(recipe.rendering.otherProperties ?? {}),
  };
  fields.push(
    sharedField(RENDERING_FIELDS.OTHER_PROPERTIES, {
      kind: "url-string-map",
      entries: otherProperties,
    })
  );

  operations.push({
    op: "CreateItem",
    policy,
    label: `rendering:${recipe.handle}`,
    id: renderingRefKey,
    path: renderingPath,
    parent: { kind: "ref-path", value: context.renderingsRoot },
    templateOf: SITECORE_TEMPLATES.RENDERING,
    name: recipe.name,
    fields,
  } satisfies CreateItemOp);
}

function emitVariants(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const folderRefKey = variantsFolderId(recipe.handle);
  const renderingRefKey = renderingId(recipe.handle);
  const renderingPath = joinPath(context.renderingsRoot, recipe.name);
  const folderPath = joinPath(renderingPath, VARIANTS_FOLDER_NAME);

  operations.push({
    op: "CreateItem",
    policy,
    label: `variants-folder:${recipe.handle}`,
    id: folderRefKey,
    path: folderPath,
    parent: { kind: "ref-recipe", refKey: renderingRefKey },
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: VARIANTS_FOLDER_NAME,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon })],
  } satisfies CreateItemOp);

  for (const variant of recipe.variants) {
    operations.push({
      op: "CreateItem",
      policy,
      label: `variant:${recipe.handle}/${variant.name}`,
      id: variantId(recipe.handle, variant.name),
      path: joinPath(folderPath, variant.name),
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: SITECORE_TEMPLATES.FOLDER,
      name: variant.name,
      fields: [versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: variant.name })],
    } satisfies CreateItemOp);
  }
}

interface BuildFieldOpInput {
  recipeHandle: string;
  fieldRefKey: string;
  fieldPath: string;
  parentRefKey: string;
  labelPrefix: string;
  field: FieldDefinition | ParamDefinition;
  zeroBasedIndex: number;
  policy: PushPolicy;
}

function buildFieldOp(input: BuildFieldOpInput): CreateItemOp {
  const { fieldRefKey, fieldPath, parentRefKey, labelPrefix, field, zeroBasedIndex, policy } =
    input;
  const sortOrder = field.sitecore?.sortOrder ?? (zeroBasedIndex + 1) * 100;
  const sitecoreType = resolveSitecoreType(field);
  const fields: FieldValue[] = [
    sharedField(TEMPLATE_FIELD_FIELDS.TYPE, {
      kind: "string",
      value: sitecoreFieldTypeLabel(sitecoreType),
    }),
    sharedField(SYSTEM_FIELDS.SORT_ORDER, { kind: "number", value: sortOrder }),
    versionedField(TEMPLATE_FIELD_FIELDS.TITLE, { kind: "string", value: field.name }),
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: field.name }),
  ];

  const sourceValue = resolveFieldSource(field, sitecoreType);
  if (sourceValue !== undefined) {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.SOURCE, sourceValue));
  }

  return {
    op: "CreateItem",
    policy,
    label: `${labelPrefix}/${field.name}`,
    id: fieldRefKey,
    path: fieldPath,
    parent: { kind: "ref-recipe", refKey: parentRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FIELD,
    name: field.name,
    fields,
  } satisfies CreateItemOp;
}

function resolveSitecoreType(field: FieldDefinition | ParamDefinition): SitecoreFieldType {
  if (field.sitecore?.type) {
    return field.sitecore.type;
  }
  const multiple = "multiple" in field ? field.multiple : undefined;
  return defaultSitecoreFieldType(field.shape, multiple);
}

/**
 * Resolve a recipe field's `Source` value to a Sitecore-encoded string.
 *
 * When `sourceTypes` references recipe handles, the wire string depends
 * on the resolved Sitecore itemIds — we can't render at compile time, so
 * we emit `ref-source-fields` and the executor finishes the job with the
 * captured-itemId resolver.
 *
 * Sources without handle references (`sourceRaw`, or `sourceQuery` /
 * `sourceScope` alone) render at compile time as a plain string.
 */
function resolveFieldSource(
  field: FieldDefinition | ParamDefinition,
  type: SitecoreFieldType
): RefValue | undefined {
  const sc = field.sitecore;
  if (sc) {
    const fields = {
      sourceTypes: sc.sourceTypes,
      sourceQuery: sc.sourceQuery,
      sourceScope: sc.sourceScope,
      sourceRaw: sc.sourceRaw,
    };
    if (sourceFieldsNeedHandleResolution(fields)) {
      return {
        kind: "ref-source-fields",
        sourceTypes: sc.sourceTypes!,
        sourceQuery: sc.sourceQuery,
        sourceScope: sc.sourceScope,
      };
    }
    const rendered = renderSourceFields(fields, () => {
      throw new Error("compile-time render should not need handle resolution");
    });
    if (rendered !== undefined) {
      return { kind: "string", value: rendered };
    }
  }
  if (type === "droplist" && field.values && field.values.length > 0) {
    return { kind: "string", value: field.values.join("|") };
  }
  return undefined;
}

interface FieldGroup {
  section: string;
  fields: FieldDefinition[];
}

/**
 * Group recipe fields by their `sitecore.section` (default "Content").
 * Section emit order = order of first occurrence in the recipe — the
 * compiler is purely stable; recipe authors control ordering.
 */
function groupFieldsBySection(fields: FieldDefinition[]): FieldGroup[] {
  const order: string[] = [];
  const bySection = new Map<string, FieldDefinition[]>();
  for (const field of fields) {
    const section = field.sitecore?.section ?? DEFAULT_FIELDS_SECTION;
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)!.push(field);
  }
  return order.map((section) => ({ section, fields: bySection.get(section)! }));
}

function sharedField(fieldGuid: string, value: FieldValue["value"]): FieldValue {
  return { fieldId: fieldGuid, value };
}

function versionedField(fieldGuid: string, value: FieldValue["value"]): FieldValue {
  return {
    fieldId: fieldGuid,
    language: DEFAULT_LANGUAGE,
    version: DEFAULT_VERSION,
    value,
  };
}
