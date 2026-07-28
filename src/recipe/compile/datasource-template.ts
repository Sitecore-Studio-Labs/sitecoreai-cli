import { fieldId, sectionId, standardValuesId, templateId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type PushPolicy,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "../ir/operations";
import { SITECORE_TEMPLATES, STANDARD_TEMPLATE_ID, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { type FieldDefinition } from "../schema/recipe";
import {
  type CompileContext,
  DEFAULT_FIELDS_SECTION,
  joinPath,
  sharedField,
  siteOf,
  versionedField,
} from "./shared";
import { buildFieldOp } from "./field-ops";
import { type ImageMediaSink, resolveMediaLocationFolder } from "./media";
import {
  buildStandardValuesFieldEntries,
  emitStandardValuesLocaleVersions,
} from "./standard-values";

export interface DatasourceTemplateInput {
  handle: string;
  name: string;
  displayName: string;
  fields: FieldDefinition[];
  insertOptions?: string[];
  /**
   * Where external-URL image DEFAULTS (Standard Values) land in the
   * media library. Site scope only — SVs are template-level, not
   * page-bound; `resolveMediaLocationFolder` rejects `scope: "page"`.
   */
  mediaLocation?: { scope: "page" | "site"; subfolder?: string };
  /**
   * Optional override for the template's parent path. When set, the
   * template lands at `<parentPath>/<name>` and `parent` resolves via
   * `ref-path`. When omitted, falls back to `context.templatesRoot`
   * for back-compat with the legacy flat layout.
   */
  parentPath?: string;
  /**
   * Optional override for the template's parent — when the parent has
   * already been emitted as a CreateItem op in this set (e.g. a section
   * folder), passing the refKey here lets the planner resolve via the
   * captured-itemId map without needing a path-based lookup. Mutually
   * exclusive with `parentPath`'s refKey-as-string semantics.
   */
  parentRefKey?: string;
  /**
   * Extra template GUIDs to append to the synthesised
   * `SetBaseTemplates` op (in addition to the implicit Standard
   * Template). Used by `compileComponentTemplateRecipe` to wire in the
   * SXA Foundation bases (`SXA_COMPONENT_BASE_TEMPLATES`) so the
   * resulting template is recognised as an SXA Headless component;
   * datasource-only callers (`compileContentTemplateRecipe`) leave it
   * unset so content templates stay shape-pure.
   */
  additionalBaseTemplates?: readonly string[];
  /**
   * Base templates resolved by TENANT PATH at apply time, forwarded to
   * the synthesised `SetBaseTemplates` op's `pathBases`. Used by
   * `compilePageTemplateRecipe` to inherit the SXA-scaffolded
   * `/sitecore/templates/Project/<collection>/Page` when the tenant has
   * one, with the raw SXA Foundation page facets as the fallback.
   */
  baseTemplatePathBases?: readonly { path: string; fallbackTemplates: string[] }[];
  /**
   * Drop the implicit Standard template from the synthesised
   * `SetBaseTemplates`. Set when `additionalBaseTemplates` already
   * chains Standard transitively (page templates: the SXA `Base Page`
   * facet carries it) — listing it explicitly is redundant noise in the
   * Content Editor's inheritance view. Callers using this MUST provide
   * a non-empty `additionalBaseTemplates` (base lists can't be empty).
   */
  omitStandardBaseTemplate?: boolean;
}

export function emitDatasourceTemplate(
  operations: Operation[],
  recipe: DatasourceTemplateInput,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const site = siteOf(context);
  const tplRefKey = templateId(site, recipe.handle);
  const parentPath = recipe.parentPath ?? context.templatesRoot;
  const tplPath = joinPath(parentPath, recipe.name);
  const parentRef: CreateItemOp["parent"] = recipe.parentRefKey
    ? { kind: "ref-recipe", refKey: recipe.parentRefKey }
    : { kind: "ref-path", value: parentPath };

  operations.push({
    op: "CreateItem",
    policy,
    label: `template:${recipe.handle}`,
    id: tplRefKey,
    path: tplPath,
    parent: parentRef,
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
    baseTemplates: [
      ...(recipe.omitStandardBaseTemplate ? [] : [STANDARD_TEMPLATE_ID]),
      ...(recipe.additionalBaseTemplates ?? []),
    ],
    ...(recipe.baseTemplatePathBases?.length
      ? { pathBases: recipe.baseTemplatePathBases.map((entry) => ({ ...entry })) }
      : {}),
  } satisfies SetBaseTemplatesOp);

  for (const group of groupFieldsBySection(recipe.fields)) {
    const secRefKey = sectionId(site, recipe.handle, group.section);
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
        ...buildFieldOp({
          recipeHandle: recipe.handle,
          fieldRefKey: fieldId(site, recipe.handle, field.name),
          fieldPath: joinPath(secPath, field.name),
          parentRefKey: secRefKey,
          labelPrefix: `field:${recipe.handle}`,
          field,
          zeroBasedIndex: index,
          policy,
          site,
          context,
        })
      );
    });
  }

  const svRefKey = standardValuesId(site, recipe.handle);
  const svPath = joinPath(tplPath, "__Standard Values");
  // Image defaults with external URLs materialise as media items —
  // the MediaUpload ops must run BEFORE the SV CreateItem so the
  // executor has captured each media itemId when it resolves the
  // entries' `media-xml-ref` values.
  const svMediaLocationFolder = resolveMediaLocationFolder(recipe.mediaLocation, {
    context,
    site,
    recipeHandle: recipe.handle,
  });
  const svImageMediaSink: ImageMediaSink = {
    policy,
    mediaOps: [],
    ...(context.mediaLibraryRoot ? { mediaLibraryRoot: context.mediaLibraryRoot } : {}),
    ...(context.imageDefaults ? { imageDefaults: context.imageDefaults } : {}),
    ...(svMediaLocationFolder ? { locationFolder: svMediaLocationFolder } : {}),
  };
  const sv = buildStandardValuesFieldEntries(
    site,
    recipe.handle,
    recipe.fields,
    fieldId,
    svImageMediaSink,
    context.availableLanguages
  );
  operations.push(...svImageMediaSink.mediaOps);
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
    // Per-field defaults from `field.default` / `field.sitecore.defaultValue`.
    // These pre-fill new datasource items so authors see meaningful
    // initial content instead of an empty form. Link defaults encode as
    // link XML; image defaults with external URLs resolve via the
    // MediaUpload ops emitted above. Locale-map defaults contribute the
    // primary-language version here; non-primary versions follow the
    // SetStandardValues link below.
    fields: sv.primary,
  } satisfies CreateItemOp);

  operations.push({
    op: "SetStandardValues",
    policy,
    label: `link-standard-values:${recipe.handle}`,
    templateRefKey: tplRefKey,
    standardValuesRefKey: svRefKey,
  } satisfies SetStandardValuesOp);

  // Per-language __Standard Values versions from locale-map defaults —
  // AddItemVersion + versioned SetField, after the SV item exists.
  emitStandardValuesLocaleVersions(
    operations,
    svRefKey,
    sv.localeVersions,
    policy,
    `standard-values:${recipe.handle}`
  );

  if (recipe.insertOptions && recipe.insertOptions.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `insert-options:${recipe.handle}`,
      itemRefKey: svRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: recipe.insertOptions.map((handle) => templateId(site, handle)),
      },
    } satisfies SetFieldOp);
  }
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
