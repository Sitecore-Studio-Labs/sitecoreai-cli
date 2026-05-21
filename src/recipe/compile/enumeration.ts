import { enumerationFolderId, enumerationsGroupingFolderId, enumValueId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import { createScaiError } from "../../shared/errors";
import { SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { type EnumerationRecipe, EnumerationRecipeSchema } from "../schema/recipe";
import {
  ensureEnumerationTemplates,
  joinPath,
  sharedField,
  siteOf,
  versionedField,
  type CompileContext,
} from "./shared";

/**
 * Compile an `EnumerationRecipe` to an Operation IR.
 *
 * Emits the per-site `Enumerations Folder` + `Enumeration` +
 * `Enumeration Value` template trio (idempotent across the recipe set
 * via the shared `emittedFolders` sentinel), an optional grouping
 * folder under `<enumerationsRoot>` driven by `recipe.location.folder`
 * (also idempotent), one CreateItem op for the per-enum container item,
 * and one CreateItem op per declared value parented under that
 * container.
 *
 * Path resolution:
 *   - With `recipe.location.folder` set →
 *     `<enumerationsRoot>/<folder>/<EnumName>/<ValueName>`. The leaf
 *     folder lands as a `CreateOnly` item conforming to the per-site
 *     `Enumerations Folder` template; multiple recipes naming the same
 *     folder path share it via the `emittedFolders` sentinel.
 *   - Without `recipe.location` (or `recipe.location.folder`) →
 *     `<enumerationsRoot>/<EnumName>/<ValueName>` (flat layout).
 *
 * Template assignment (each item conforms to a different template —
 * roles are NOT collapsed):
 *   - Grouping folders         → `Enumerations Folder` template
 *   - Per-enum container       → `Enumeration` template
 *   - Leaf value items         → `Enumeration Value` template
 *
 * All three templates inherit Standard Template and stamp the
 * `keyboard_key_e.png` icon via template-level inheritance, so the SXA
 * editor shows enum items with the enum icon without per-item overrides.
 *
 * Each value item also writes its `value.name` to the `Value` shared
 * field defined on the `Enumeration Value` template's inner
 * `Enumeration` section. Without this the value items would have no
 * payload — the Droplink picker would still enumerate them, but
 * consumers reading the picked item's `Value` field (the canonical SXA
 * pattern) would find it empty.
 *
 * Refkeys:
 *   - Grouping folder: `enumerationsGroupingFolderId(site, folder)` —
 *     site + cumulative path keyed so two recipes naming the same
 *     folder reuse one item rather than colliding.
 *   - Per-enum container:  `enumerationFolderId(site, recipe.handle)` —
 *     site-scoped so cross-site pushes don't collide. (Function name is
 *     legacy; the item it identifies is the per-enum container, not a
 *     folder.)
 *   - Values:  `enumValueId(folderRefKey, value.name)` — value-name keyed
 *     under the container. Renaming a value (`primary` → `accent`) emits
 *     a different GUID; consuming fields whose default referenced the
 *     old name end up orphaned. Author error.
 *
 * Throws `INPUT_INVALID` when `context.enumerationsRoot` is unset, or
 * when `recipe.location.scope` is `"siteCollection"` (reserved for
 * shared-vocabulary use; not yet implemented).
 */
export function compileEnumerationRecipe(
  input: EnumerationRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = EnumerationRecipeSchema.parse(input);
  if (!context.enumerationsRoot) {
    throw createScaiError(
      `Recipe '${recipe.handle}' is an enumeration but no enumerationsRoot is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `enumerationsRoot` on the active envProfile in sitecoreai.cli.json (e.g. `/sitecore/content/<siteCollection>/<site>/Settings/Enumerations`).",
      }
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const {
    folderTemplateRefKey,
    enumerationTemplateRefKey,
    containerValueFieldRefKey,
    valueTemplateRefKey,
    valueFieldRefKey,
  } = ensureEnumerationTemplates(operations, context, site, emittedFolders);

  // Validate `default` matches one of the declared value names. Lives
  // here (not on the schema) because `discriminatedUnion` rejects
  // `ZodEffects` members, so cross-field validation can't be expressed
  // on `EnumerationRecipeSchema` directly.
  if (recipe.default !== undefined) {
    const valueNames = new Set(recipe.values.map((v) => v.name));
    if (!valueNames.has(recipe.default)) {
      throw createScaiError(
        `Recipe '${recipe.handle}' declares default='${recipe.default}' but no matching value.name.`,
        "INPUT_INVALID",
        {
          hint: `default must match one of values[].name (got: ${[...valueNames].join(", ") || "<none>"}).`,
        }
      );
    }
  }

  // siteCollection scope is reserved for shared-vocabulary use
  // (multiple sites in a collection sourcing one canonical enum) but
  // requires a `siteCollectionEnumerationsRoot` on `CompileContext`
  // that doesn't exist yet. Reject explicitly so authors don't get a
  // surprise misplacement.
  if (recipe.location?.scope === "siteCollection") {
    throw createScaiError(
      `Recipe '${recipe.handle}' declares location.scope='siteCollection' but the siteCollection enumerations root isn't wired up yet.`,
      "INPUT_INVALID",
      {
        hint: 'Use `location.scope: "site"` for now (or omit `location`). Site-collection scope will land when the orchestrator threads a siteCollectionEnumerationsRoot through CompileContext.',
      }
    );
  }

  // Optional grouping folder(s) driven by `location.folder`. CreateOnly +
  // dedup via emittedFolders so multiple recipes naming the same folder
  // share one item. Multi-segment paths (e.g. "Components/Card") split
  // on `/` — EVERY segment gets an explicit CreateItem conforming to
  // the per-site Enumerations Folder template (intermediates included).
  // Without an explicit emit per segment, Sitecore's executor path-walker
  // auto-creates intermediates as the generic `Folder` template, which
  // breaks the Insert Options chain (a generic Folder doesn't carry
  // the Enumerations Folder Standard Values, so authors right-clicking
  // `Components/` see no Insert Options for `Enumeration` /
  // `Enumerations Folder`).
  //
  // Each segment is keyed on its CUMULATIVE path (`enumerationsGroupingFolderId(site,
  // cumulativePath)`) so two recipes sharing a prefix (`Components/Card`
  // + `Components/Tabs`) reuse the same `Components` item rather than
  // colliding. Parent chain: first segment ref-paths the enumerations
  // root; subsequent segments ref-recipe the prior segment so the
  // executor resolves the captured itemId.
  let parentPath = context.enumerationsRoot;
  let parentRef: CreateItemOp["parent"] = {
    kind: "ref-path",
    value: context.enumerationsRoot,
  };
  const folder = recipe.location?.folder;
  if (folder) {
    const folderSegments = folder
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (folderSegments.length === 0) {
      throw createScaiError(
        `Recipe '${recipe.handle}' declares location.folder that is empty after trimming.`,
        "INPUT_INVALID",
        {
          hint: "Use a non-empty folder string like 'Theme' or 'Components/Card'.",
        }
      );
    }
    const cumulativeSegments: string[] = [];
    for (const segment of folderSegments) {
      cumulativeSegments.push(segment);
      const cumulativePath = cumulativeSegments.join("/");
      const segmentRefKey = enumerationsGroupingFolderId(site, cumulativePath);
      const segmentPath = joinPath(context.enumerationsRoot, cumulativePath);
      if (!emittedFolders.has(segmentRefKey)) {
        emittedFolders.add(segmentRefKey);
        operations.push({
          op: "CreateItem",
          policy: "CreateOnly",
          label: `enumerations-grouping-folder:${site}:${cumulativePath}`,
          id: segmentRefKey,
          path: segmentPath,
          parent: parentRef,
          templateOf: folderTemplateRefKey,
          name: segment,
          fields: [],
        } satisfies CreateItemOp);
      }
      parentPath = segmentPath;
      parentRef = { kind: "ref-recipe", refKey: segmentRefKey };
    }
  }

  // Per-enum container item (e.g. `Color Scheme`, `Heading Size`).
  // Conforms to the `Enumeration` template — NOT `Enumerations Folder`,
  // which is reserved for grouping folders. The container's own
  // `__Standard Values` (set on the Enumeration template) advertises
  // `Enumeration Value` as the only Insert Option, so authors can
  // right-click → Insert → Enumeration Value to add a value.
  //
  // RefKey name `folderRefKey` is legacy from before the template
  // separation — the item it identifies is the per-enum container, not
  // a folder.
  const folderRefKey = enumerationFolderId(site, recipe.handle);
  const folderPath = joinPath(parentPath, recipe.name);
  const folderDisplayName = recipe.displayName ?? recipe.name;

  // When `recipe.default` is set, write it to the container's `Value`
  // shared field. The field write carries `fieldName: "Value"` so the
  // executor's tenant-side resolver matches by name (recipe-derived
  // field GUIDs don't line up with server-assigned ones once the
  // template is materialised) — same pattern as the leaf value items.
  const containerFields: CreateItemOp["fields"] = [
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: folderDisplayName }),
  ];
  if (recipe.default !== undefined) {
    containerFields.push({
      ...sharedField(containerValueFieldRefKey, { kind: "string", value: recipe.default }),
      fieldName: "Value",
    });
  }

  operations.push({
    op: "CreateItem",
    policy,
    label: `enumeration:${recipe.handle}`,
    id: folderRefKey,
    path: folderPath,
    parent: parentRef,
    templateOf: enumerationTemplateRefKey,
    name: recipe.name,
    fields: containerFields,
  } satisfies CreateItemOp);

  for (const value of recipe.values) {
    const valueDisplayName = value.displayName ?? value.name;
    operations.push({
      op: "CreateItem",
      policy,
      label: `enumeration-value:${recipe.handle}/${value.name}`,
      id: enumValueId(folderRefKey, value.name),
      path: joinPath(folderPath, value.name),
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: valueTemplateRefKey,
      name: value.name,
      // The `Value` shared field carries the actual enumeration string
      // (matches canonical pattern: each value item under
      // `Background Themes/shooting-star` stores `Value: "shooting-star"`).
      // `fieldName` is required so the executor's tenant-side resolver
      // can locate the field by name — the recipe-derived `valueFieldRefKey`
      // doesn't match the Sitecore-assigned field GUID after the template
      // is materialised.
      fields: [
        {
          ...sharedField(valueFieldRefKey, { kind: "string", value: value.name }),
          fieldName: "Value",
        },
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
          kind: "string",
          value: valueDisplayName,
        }),
      ],
    } satisfies CreateItemOp);
  }

  // Per-data-folder __Standard Values is intentionally NOT emitted —
  // Insert Options now live on the Enumerations Folder template's own
  // Standard Values (set up in `ensureEnumerationTemplates`) and
  // propagate to every item conforming to the template. Emitting an SV
  // ITEM under each data folder would re-introduce the old bug where
  // the Droplink picker enumerates the SV as a sibling of the enum
  // value items (the Source path's children include any direct child).
  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
