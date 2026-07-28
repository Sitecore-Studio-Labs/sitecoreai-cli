import { enumerationFolderId, enumValueId } from "../items/guids";
import {
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type PushPolicy,
  type RefValue,
} from "../ir/operations";
import { SITECORE_TEMPLATES, SYSTEM_FIELDS, TEMPLATE_FIELD_FIELDS } from "../ir/sitecore-templates";
import { type FieldDefinition, type DesignParameter } from "../schema/recipe";
import { type SitecoreFieldType, sitecoreFieldTypeLabel } from "../schema/field-types";
import {
  applyMarketplacePluginOverride,
  augmentSourceToFields,
  renderSourceFields,
  sourceFieldsNeedHandleResolution,
} from "../schema/source-fields";
import { createScaiError } from "@/shared/errors";
import {
  type CompileContext,
  resolveEnumFolderPath,
  resolveSitecoreType,
  sharedField,
  versionedField,
} from "./shared";

export interface BuildFieldOpInput {
  recipeHandle: string;
  fieldRefKey: string;
  fieldPath: string;
  parentRefKey: string;
  labelPrefix: string;
  field: FieldDefinition | DesignParameter;
  zeroBasedIndex: number;
  /**
   * Offset added to the auto-assigned `(zeroBasedIndex + 1) * 100` when
   * the field has no explicit `sitecore.sortOrder`. Default 0.
   *
   * Used by rendering parameters templates: the SXA Headless params base
   * templates ship `RenderingIdentifier`, `Styles`, `GridParameters`, etc.
   * at sortOrder values in the low hundreds. Inline `params:` would tie
   * or interleave with those on the inherited fields' `__Sortorder`,
   * making the Pages parameters dialog render custom params mixed in
   * between `id` and `css styles`. Passing a high base (e.g. `1000`)
   * pushes synthesised params cleanly below the inherited standards.
   */
  sortOrderBase?: number;
  policy: PushPolicy;
  /**
   * Site name the recipe set is being compiled under. Threaded through to
   * `resolveFieldSource` so the emitted `ref-source-fields` value carries
   * the site — the executor's resolver needs it to derive `templateId(site,
   * handle)` for handle references in `sourceTypes`.
   */
  site: string;
  /**
   * Compile context — used by `resolveFieldSource` to look up
   * `sitecore.enumHandle` references against `enumsByHandle` and emit
   * the enum's tenant content path as the Droplink Source value.
   * Standalone callers can omit it, but any field with
   * `sitecore.enumHandle` will then throw INPUT_INVALID since the path
   * can't be resolved.
   */
  context?: CompileContext;
}

/**
 * Build the CreateItem op for a single field definition.
 *
 * Always returns exactly one op — the field-definition item itself.
 * Backing storage for enum-shaped fields is decided by the field's
 * `sitecore.type` / `sitecore.enumHandle` and resolved into the
 * `Source` field via `resolveFieldSource`:
 *   - `sitecore.type: "droplist"` + inline `values: [...]` → Source is
 *     a pipe-separated literal; Sitecore enumerates the string directly,
 *     no value items needed.
 *   - `sitecore.enumHandle: "<handle>"` (Droplink default) → Source is
 *     the EnumerationRecipe's folder path on the tenant; the picker
 *     enumerates that path's children at editor time. The values live
 *     under the `EnumerationRecipe`'s folder item, emitted by
 *     `compileEnumerationRecipe`.
 *
 * Inline Droplink (`shape: "enum"` + inline `values` + no `enumHandle`
 * + no `sitecore.type` override) is rejected by `resolveFieldSource`
 * with INPUT_INVALID — it never reliably worked in SXA Headless's
 * rendering parameters dialog (the picker couldn't enumerate the
 * per-field folder), so authors must commit to one of the two
 * supported shapes.
 */
export function buildFieldOp(input: BuildFieldOpInput): Operation[] {
  const {
    recipeHandle,
    fieldRefKey,
    fieldPath,
    parentRefKey,
    labelPrefix,
    field,
    zeroBasedIndex,
    sortOrderBase = 0,
    policy,
    site,
    context,
  } = input;
  // Explicit `sitecore.sortOrder` values from the recipe are treated as
  // RELATIVE to the field group's base so existing recipes (which were
  // authored with `sortOrder: 100, 200, 300, ...`) continue to make
  // sense — for params, sortOrderBase=PARAMS_SORT_ORDER_BASE (1000)
  // lifts them above SXA's inherited low-hundreds fields. For
  // datasource fields, sortOrderBase=0 so explicit values are unchanged.
  // Auto-assigned values (no explicit sortOrder) get the same base +
  // 100-step increment.
  const explicitSortOrder = field.sitecore?.sortOrder;
  const sortOrder =
    explicitSortOrder != null
      ? sortOrderBase + explicitSortOrder
      : sortOrderBase + (zeroBasedIndex + 1) * 100;
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

  const sourceValue = resolveFieldSource(field, sitecoreType, site, recipeHandle, context);
  if (sourceValue !== undefined) {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.SOURCE, sourceValue));
  }

  // Field storage axis. `versioned` is Sitecore's default for a new
  // Template Field (Shared + Unversioned both unset) — emit nothing.
  // IMAGE fields default to SHARED: brand imagery is language-invariant
  // (the registry's role-based image defaults must show in every locale,
  // and per-language image versions were empty everywhere but `en` —
  // Sitecore has no field-level fallback by default). A recipe that
  // genuinely wants per-locale imagery opts out with an explicit
  // `sitecore.storage: "versioned"`.
  const storage = field.sitecore?.storage ?? (field.shape === "image" ? "shared" : undefined);
  if (storage === "shared") {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.SHARED, { kind: "string", value: "1" }));
  } else if (storage === "unversioned") {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.UNVERSIONED, { kind: "string", value: "1" }));
  }

  return [
    {
      op: "CreateItem",
      policy,
      label: `${labelPrefix}/${field.name}`,
      id: fieldRefKey,
      path: fieldPath,
      parent: { kind: "ref-recipe", refKey: parentRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      name: field.name,
      fields,
    } satisfies CreateItemOp,
  ];
}

/**
 * Map a recipe-level rendering-parameter VALUE to the wire form the
 * parameter's Sitecore field type stores — the form XM Cloud Pages'
 * properties panel reads back (operator-verified against working tenant
 * pages, where enum params ride as `%7BGUID%7D` and checkboxes as `1`):
 *
 *  - **checkbox** — `"true"`/`"1"` → `"1"`, anything else → `""`.
 *    A checkbox field holding the literal `true` displays as unchecked.
 *  - **enum-backed Droplink** (`shape: "enum"` + `sitecore.enumHandle`,
 *    not overridden to droplist) — the value NAME becomes the enum
 *    value item's curly-braced refKey GUID (`enumValueId` under
 *    `enumerationFolderId`), which plan-time captured-id substitution
 *    resolves to the real tenant item. A Droplink holding a raw name
 *    displays as unset and Edge's params resolution can't map it.
 *  - **droplist** (pipe-list Source) — stores the raw name; no mapping.
 *  - anything else — `undefined` (caller keeps the raw value).
 */
export function paramWireValue(
  param: DesignParameter,
  raw: string,
  site: string
): string | undefined {
  const type = resolveSitecoreType(param);
  if (type === "checkbox") {
    return raw === "true" || raw === "1" ? "1" : "";
  }
  if (param.shape === "enum" && type !== "droplist" && param.sitecore?.enumHandle) {
    return `{${enumValueId(enumerationFolderId(site, param.sitecore.enumHandle), raw).toUpperCase()}}`;
  }
  return undefined;
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
 *
 * Enum fields (`shape: "enum"`) accept exactly two shapes — the
 * compiler rejects anything else with INPUT_INVALID:
 *   - **Type=Droplink + `sitecore.enumHandle`** (the canonical shared
 *     shape): Source is the EnumerationRecipe's tenant content path
 *     (resolved via `context.enumsByHandle`). SXA enumerates that
 *     path's children as picker entries; the values live as content
 *     items the EnumerationRecipe owns. Source is emitted as a path
 *     string (not a `{GUID}`) — SXA Headless's rendering parameter
 *     dialog only enumerates Droplink Source as a content path / query.
 *   - **Type=Droplist (override) + inline `values: [...]`**: Source is
 *     a pipe-separated literal of the values — Sitecore reads the
 *     option list straight out of the Source string with no folder
 *     lookup. No content items are emitted.
 *
 * Inline Droplink (shape=enum + `values` + neither override) is rejected
 * here: SXA Headless's rendering parameters dialog never reliably picked
 * up the per-field folder of values, so authors must commit to one of
 * the two supported shapes.
 *
 * Shared-enum + Droplist isn't supported either — Droplist needs values
 * at compile time, which we can't resolve from a sibling EnumerationRecipe
 * without a lookup.
 */
function resolveFieldSource(
  field: FieldDefinition | DesignParameter,
  type: SitecoreFieldType,
  site: string,
  recipeHandle: string,
  context?: CompileContext
): RefValue | undefined {
  const sc = field.sitecore;
  if (sc) {
    const effectiveSource = applyMarketplacePluginOverride(
      sc.source,
      context?.marketplacePluginOverrides
    );
    const fields = augmentSourceToFields(effectiveSource);
    if (sourceFieldsNeedHandleResolution(fields)) {
      // `types` is non-empty here because `sourceFieldsNeedHandleResolution`
      // returned true; the cast is to satisfy the IR's `.min(1)` constraint.
      return {
        kind: "ref-source-fields",
        site,
        sourceTypes: fields.sourceTypes as string[],
        sourceQuery: fields.sourceQuery,
        sourceScope: fields.sourceScope,
      };
    }
    const rendered = renderSourceFields(fields, () => {
      throw createScaiError("compile-time render should not need handle resolution", "UNKNOWN");
    });
    if (rendered !== undefined) {
      return { kind: "string", value: rendered };
    }
  }
  // Reference-shape + enumHandle = multi-pick Treelist sourced from a
  // shared enum. Earlier iterations emitted the combined form
  // `DataSource=<path>&IncludeTemplatesForSelection=<GUID>` so the
  // picker would scope to the enum's folder AND restrict pickable
  // items to the enum value template — but Sitecore Pages's Treelist
  // chrome rejected every enum-value pick under that filter, leaving
  // authors with "the source's filter doesn't allow those options"
  // and no way to select platforms. The filter isn't load-bearing in
  // practice: scai deliberately doesn't emit per-folder
  // `__Standard Values` items inside enum folders (see the comment
  // in `compileEnumerationRecipe`), so the enum folder's children
  // are exactly the value items the picker should surface. Dropping
  // the template filter keeps the picker working in Pages and only
  // matters for tenants where an author manually drops stray content
  // under an enum folder (rare and recoverable). Single-pick
  // reference (Droplink) follows the same plain-`DataSource=` shape.
  if (field.shape === "reference" && sc?.enumHandle) {
    if (!context) {
      throw createScaiError(
        `Field '${field.name}' on recipe '${recipeHandle}' uses sitecore.enumHandle='${sc.enumHandle}' on a reference field but the field-op builder was invoked without a CompileContext.`,
        "INPUT_INVALID",
        {
          hint: "Pass `context` into `buildFieldOp` so the enum's tenant path can be resolved from `enumsByHandle` + `enumerationsRoot`.",
        }
      );
    }
    const enumPath = resolveEnumFolderPath(context, sc.enumHandle, recipeHandle);
    return {
      kind: "string",
      value: `DataSource=${enumPath}`,
    };
  }
  if (field.shape === "enum") {
    // Droplist override on an enum field needs the inline values
    // baked into Source as a pipe-separated literal — SXA's Droplist
    // enumerates the string directly and never reads a folder.
    if (type === "droplist") {
      if (!field.values || field.values.length === 0) {
        throw createScaiError(
          `Field '${field.name}' on recipe '${recipeHandle}' overrides sitecore.type to 'droplist' but declares no inline values; Droplist needs an inline value list.`,
          "INPUT_INVALID",
          {
            hint: 'Either drop the `sitecore.type: "droplist"` override and add `sitecore.enumHandle: "<recipe>@<v>"` (shared Droplink), or add `values: [...]` to the field.',
          }
        );
      }
      return { kind: "string", value: field.values.join("|") };
    }
    if (sc?.enumHandle) {
      // Shared enum + Droplink — Source is the enum folder's tenant
      // content path (NOT a `{GUID}` reference). SXA Headless's
      // rendering parameter dialog enumerates Droplink Source as a path
      // / query; a bare GUID doesn't reliably surface picker options.
      // Path is computable at compile time from the EnumerationRecipe
      // looked up via `context.enumsByHandle`.
      if (!context) {
        throw createScaiError(
          `Field '${field.name}' on recipe '${recipeHandle}' uses sitecore.enumHandle='${sc.enumHandle}' but the field-op builder was invoked without a CompileContext.`,
          "INPUT_INVALID",
          {
            hint: "Pass `context` into `buildFieldOp` so the enum's tenant path can be resolved from `enumsByHandle` + `enumerationsRoot`.",
          }
        );
      }
      const enumPath = resolveEnumFolderPath(context, sc.enumHandle, recipeHandle);
      return { kind: "string", value: enumPath };
    }
    // Inline Droplink (shape=enum + values + no enumHandle + no Droplist
    // override) is not a valid shape — SXA Headless's rendering parameter
    // dialog never reliably picked up a per-field folder of values, so the
    // dropdown stayed empty in Pages. Force the author to commit:
    //   - Inline scale → `sitecore.type: "droplist"` + inline `values`.
    //   - Shared scale → `sitecore.enumHandle: "<EnumerationRecipe>@<v>"`.
    throw createScaiError(
      `Field '${field.name}' on recipe '${recipeHandle}' is shape=enum but declares neither sitecore.type='droplist' (with inline values) nor sitecore.enumHandle (pointing at a shared EnumerationRecipe); inline Droplink isn't supported.`,
      "INPUT_INVALID",
      {
        hint: 'Pick one: add `sitecore.type: "droplist"` for an inline pipe-list dropdown, or `sitecore.enumHandle: "<recipe>@<v>"` to point at a shared EnumerationRecipe (which authors edit out-of-band as content items).',
      }
    );
  }
  if (type === "droplist" && field.values && field.values.length > 0) {
    return { kind: "string", value: field.values.join("|") };
  }
  return undefined;
}
