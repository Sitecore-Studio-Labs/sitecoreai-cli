import {
  enumerationContainerSectionId,
  enumerationContainerValueFieldId,
  enumerationsFolderTemplateId,
  enumerationsFolderTemplateStandardValuesId,
  enumerationTemplateId,
  enumerationTemplateSectionId,
  enumerationTemplateStandardValuesId,
  enumerationTemplateValueFieldId,
  enumerationValueTemplateId,
} from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "../ir/operations";
import {
  ENUMERATION_ICON,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../ir/sitecore-templates";
import { sitecoreFieldTypeLabel } from "../schema/field-types";
import { type CompileContext, joinPath, sharedField, versionedField } from "./shared";

/**
 * Per-site SXA-style enumeration template trio. Three templates with
 * distinct roles — emitted as siblings under the site's
 * `Presentation/` templates folder:
 *
 *   Enumerations Folder        → folder layers in the enum content tree
 *                                (root, per-folder grouping items)
 *     └── __Standard Values    Insert Options: Enumeration + Enumerations Folder
 *
 *   Enumeration                → per-enum container items
 *                                (`Color Scheme`, `Heading Size`, etc.)
 *     └── __Standard Values    Insert Options: Enumeration Value
 *
 *   Enumeration Value          → leaf value items
 *                                (`primary`, `accent`, `lg`, `shooting-star`)
 *     └── Enumeration (section)
 *           └── Value (Single-Line Text, shared)
 *
 * All three inherit from Standard Template only and stamp the
 * `keyboard_key_e.png` icon so the SXA editor recognises enum items
 * as enumeration entries (not folders) without per-item icon overrides.
 *
 * The `Value` field on `Enumeration Value` carries each value item's
 * actual enumeration string (`"primary"`, `"shooting-star"`, etc.) —
 * the canonical SXA "picked item's Value field" payload that Droplink
 * consumers (XM Cloud Pages, JSS variants, custom Edge resolvers) read.
 *
 * Insert Options are wired so authors can right-click without picking
 * templates from a long list:
 *   - Inside an `Enumerations Folder` → Insert: `Enumeration` (typical)
 *     or `Enumerations Folder` (nesting, e.g. `Theme/Color`)
 *   - Inside an `Enumeration` → Insert: `Enumeration Value` only
 *   - Inside an `Enumeration Value` → no Insert Options (leaves)
 *
 * Idempotent across the recipe set — the templates are emitted on
 * first call and re-uses are no-ops via the shared `emittedFolders`
 * set. Returns the deterministic refKeys for all three templates +
 * the `Value` field so callers can wire `templateOf` and `Value` field
 * writes correctly.
 */
export interface EnumerationTemplateRefs {
  folderTemplateRefKey: string;
  /** Per-enum container template (Color Scheme, Heading Size, …). */
  enumerationTemplateRefKey: string;
  /**
   * RefKey of the `Value` Template Field under the *Enumeration*
   * template's inner `Enumeration` section. Carries each per-enum
   * container's canonical default (driven by `EnumerationRecipe.default`).
   * Distinct from `valueFieldRefKey` (which is on the Enumeration Value
   * template, for leaf items).
   */
  containerValueFieldRefKey: string;
  /** Leaf value template (primary, accent, lg, …). Carries the `Value` field. */
  valueTemplateRefKey: string;
  /**
   * RefKey of the `Value` Template Field under the Enumeration Value
   * template. Callers writing the field on individual value items pair
   * this with `fieldName: "Value"` so the executor's tenant-side
   * resolver can locate the field by name (recipe-derived field GUIDs
   * don't match the Sitecore-assigned ones).
   */
  valueFieldRefKey: string;
}

/**
 * The `emittedFolders` sentinel key guarding the shared enumeration
 * template trio's one-time emission. Exported so `compileRecipeSet` can
 * PRE-SEED it: when the whole set is compiled, the templates + their
 * `__Standard Values` are emitted once via the stable
 * `__enumeration-templates__` FRONT aggregate (owned by that synthetic
 * handle so tenant ownership never drifts between rebuilds), and every
 * per-recipe `ensureEnumerationTemplates` call short-circuits to
 * refKeys-only. A single-recipe compile (no set, fresh set) still emits
 * the templates inline so the IR stays self-contained.
 */
export const enumerationTemplatesSentinel = (site: string): string =>
  `enumeration-templates:${site}`;

export const ensureEnumerationTemplates = (
  operations: Operation[],
  context: CompileContext,
  site: string,
  emittedFolders: Set<string>
): EnumerationTemplateRefs => {
  const folderTemplateRefKey = enumerationsFolderTemplateId(site);
  const enumerationTemplateRefKey = enumerationTemplateId(site);
  const containerValueFieldRefKey = enumerationContainerValueFieldId(site);
  const valueTemplateRefKey = enumerationValueTemplateId(site);
  const valueFieldRefKey = enumerationTemplateValueFieldId(site);
  const sentinel = enumerationTemplatesSentinel(site);
  if (emittedFolders.has(sentinel)) {
    return {
      folderTemplateRefKey,
      enumerationTemplateRefKey,
      containerValueFieldRefKey,
      valueTemplateRefKey,
      valueFieldRefKey,
    };
  }
  emittedFolders.add(sentinel);

  // Enum templates live at the SITE templates root's `/Presentation`
  // bucket (sibling of `/Components`), NOT nested under `/Components`.
  // Orchestrators typically alias `templatesRoot` and `componentsRoot`
  // to the same `<siteRoot>/Components` value; strip the trailing
  // `/Components` segment from whichever is provided to land on the
  // site templates root. When the input doesn't end in `/Components`
  // (legacy flat layout), use it as-is.
  const root = context.componentsRoot ?? context.templatesRoot;
  const siteTemplatesRoot = root.replace(/\/Components$/, "");
  const parentPath = joinPath(siteTemplatesRoot, "Presentation");

  const templateEntries: ReadonlyArray<{ refKey: string; name: string }> = [
    { refKey: folderTemplateRefKey, name: "Enumerations Folder" },
    { refKey: enumerationTemplateRefKey, name: "Enumeration" },
    { refKey: valueTemplateRefKey, name: "Enumeration Value" },
  ];

  for (const { refKey, name } of templateEntries) {
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `enumeration-template:${site}:${name}`,
      id: refKey,
      path: joinPath(parentPath, name),
      parent: { kind: "ref-path", value: parentPath },
      templateOf: SITECORE_TEMPLATES.TEMPLATE,
      name,
      fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: ENUMERATION_ICON })],
    } satisfies CreateItemOp);

    operations.push({
      op: "SetBaseTemplates",
      policy: "CreateOnly",
      label: `enumeration-template-base:${site}:${name}`,
      itemRefKey: refKey,
      baseTemplates: [STANDARD_TEMPLATE_ID],
    } satisfies SetBaseTemplatesOp);
  }

  // Inner `Enumeration` Section + `Value` field — emitted on BOTH the
  // Enumeration template (for the per-enum container's default value)
  // and the Enumeration Value template (for each leaf value's payload).
  // Same field name + shape on both so Edge consumers query the same
  // way to read either the canonical default (off the container) or a
  // leaf payload (off a value item):
  //   `item.field("Value").value`.
  const innerValueFieldEntries: ReadonlyArray<{
    templatePath: string;
    templateRefKey: string;
    sectionRefKey: string;
    fieldRefKey: string;
    labelPrefix: string;
  }> = [
    {
      templatePath: joinPath(parentPath, "Enumeration"),
      templateRefKey: enumerationTemplateRefKey,
      sectionRefKey: enumerationContainerSectionId(site),
      fieldRefKey: containerValueFieldRefKey,
      labelPrefix: "enumeration-template",
    },
    {
      templatePath: joinPath(parentPath, "Enumeration Value"),
      templateRefKey: valueTemplateRefKey,
      sectionRefKey: enumerationTemplateSectionId(site),
      fieldRefKey: valueFieldRefKey,
      labelPrefix: "enumeration-value-template",
    },
  ];

  for (const e of innerValueFieldEntries) {
    const sectionPath = joinPath(e.templatePath, "Enumeration");
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `${e.labelPrefix}-section:${site}`,
      id: e.sectionRefKey,
      path: sectionPath,
      parent: { kind: "ref-recipe", refKey: e.templateRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      name: "Enumeration",
      fields: [],
    } satisfies CreateItemOp);

    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `${e.labelPrefix}-value-field:${site}`,
      id: e.fieldRefKey,
      path: joinPath(sectionPath, "Value"),
      parent: { kind: "ref-recipe", refKey: e.sectionRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      name: "Value",
      fields: [
        sharedField(TEMPLATE_FIELD_FIELDS.TYPE, {
          kind: "string",
          value: sitecoreFieldTypeLabel("single-line-text"),
        }),
        sharedField(SYSTEM_FIELDS.SORT_ORDER, { kind: "number", value: 100 }),
        sharedField(TEMPLATE_FIELD_FIELDS.SHARED, { kind: "string", value: "1" }),
        versionedField(TEMPLATE_FIELD_FIELDS.TITLE, { kind: "string", value: "Value" }),
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: "Value" }),
      ],
    } satisfies CreateItemOp);
  }

  // Standard Values + Insert Options for each template that authors can
  // insert into. Living at the template definition (not at every data
  // folder) keeps Droplink picker results clean — only real value items
  // appear, no stray __Standard Values siblings.
  const standardValuesEntries: ReadonlyArray<{
    templateRefKey: string;
    templateName: string;
    svRefKey: string;
    insertOptions: readonly string[];
  }> = [
    {
      templateRefKey: folderTemplateRefKey,
      templateName: "Enumerations Folder",
      svRefKey: enumerationsFolderTemplateStandardValuesId(site),
      // Folders contain enums (typical) or sub-folders (nesting via
      // multi-segment `folder: "Theme/Color"` recipes).
      insertOptions: [enumerationTemplateRefKey, folderTemplateRefKey],
    },
    {
      templateRefKey: enumerationTemplateRefKey,
      templateName: "Enumeration",
      svRefKey: enumerationTemplateStandardValuesId(site),
      // Per-enum items only contain values — never sub-enums or folders.
      insertOptions: [valueTemplateRefKey],
    },
  ];

  for (const entry of standardValuesEntries) {
    const svPath = joinPath(joinPath(parentPath, entry.templateName), "__Standard Values");
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `enumeration-template-standard-values:${site}:${entry.templateName}`,
      id: entry.svRefKey,
      path: svPath,
      parent: { kind: "ref-recipe", refKey: entry.templateRefKey },
      templateOf: entry.templateRefKey,
      name: "__Standard Values",
      fields: [],
    } satisfies CreateItemOp);

    // SetStandardValues + Insert Options are recipe-controlled and
    // CreateAndUpdate so re-pushes always reconcile the link + the
    // Insert Options list — there's no "preserve CMS edit" case worth
    // honouring (authors edit the recipe, not the SV's __Masters field
    // directly), and CreateOnly was leaving stale values from earlier
    // broken pushes in place.
    operations.push({
      op: "SetStandardValues",
      policy: "CreateAndUpdate",
      label: `enumeration-template-link-standard-values:${site}:${entry.templateName}`,
      templateRefKey: entry.templateRefKey,
      standardValuesRefKey: entry.svRefKey,
    } satisfies SetStandardValuesOp);

    // `ref-recipe-list`, NOT `ref-guid-list` — the executor must
    // resolve each template refKey against the captured-itemId map to
    // the server-assigned itemId before rendering. `ref-guid-list`
    // emits refKey GUIDs verbatim; those are deterministic compile-time
    // values, not the actual tenant-side template IDs, so the resulting
    // `__Masters` value points at items that don't exist and the
    // editor's Insert menu silently has nothing to enumerate.
    operations.push({
      op: "SetField",
      policy: "CreateAndUpdate",
      label: `enumeration-template-insert-options:${site}:${entry.templateName}`,
      itemRefKey: entry.svRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: [...entry.insertOptions],
      },
    } satisfies SetFieldOp);
  }

  return {
    folderTemplateRefKey,
    enumerationTemplateRefKey,
    containerValueFieldRefKey,
    valueTemplateRefKey,
    valueFieldRefKey,
  };
};
