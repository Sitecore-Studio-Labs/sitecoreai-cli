import { enumerationFolderId, enumValueId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import { createScaiError } from "@/shared/errors";
import { SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { type EnumerationRecipe, EnumerationRecipeSchema } from "../schema/recipe";
import {
  ensureEnumerationGroupingFolders,
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

  // Optional grouping folder(s) driven by `location.folder`. Extracted to
  // `ensureEnumerationGroupingFolders` so the `__shared-folders__` FRONT
  // aggregate can materialise the SAME chain once for the whole set — a
  // grouping folder shared by two enum recipes that land in separate
  // `--handles` chunks would otherwise be owned by whichever compiled
  // first, and a chunk missing that owner leaves the executor's path-walker
  // to auto-create the folder as a generic `Folder` (breaking the Insert
  // Options chain). `recipe.location.folder` is normalized to a trimmed,
  // non-empty `string[]` by the schema (`FolderPath`).
  const { parentPath, parentRef } = ensureEnumerationGroupingFolders(
    operations,
    context,
    recipe.location?.folder,
    folderTemplateRefKey,
    emittedFolders
  );

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
    // The `Value` shared field carries the actual enumeration string
    // (matches canonical pattern: each value item under
    // `Background Themes/shooting-star` stores `Value: "shooting-star"`).
    // `fieldName` is required so the executor's tenant-side resolver
    // can locate the field by name — the recipe-derived `valueFieldRefKey`
    // doesn't match the Sitecore-assigned field GUID after the template
    // is materialised.
    const valueFields: CreateItemOp["fields"] = [
      {
        ...sharedField(valueFieldRefKey, { kind: "string", value: value.name }),
        fieldName: "Value",
      },
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
        kind: "string",
        value: valueDisplayName,
      }),
    ];
    // Optional per-value "when to use this" guidance → shared `__Help
    // text` field, so it surfaces in the Content Editor tooltip AND
    // rides along in the published recipe JSON for page-composing
    // agents. Same well-known system-field GUID the dictionary
    // compiler writes phrase descriptions to (`SYSTEM_FIELDS.HELP_TEXT`),
    // so no `fieldName` resolution is needed — the GUID is stable
    // across tenants. Only emitted when set to keep description-free
    // values byte-identical to before.
    if (value.description) {
      valueFields.push(
        sharedField(SYSTEM_FIELDS.HELP_TEXT, { kind: "string", value: value.description })
      );
    }
    operations.push({
      op: "CreateItem",
      policy,
      label: `enumeration-value:${recipe.handle}/${value.name}`,
      id: enumValueId(folderRefKey, value.name),
      path: joinPath(folderPath, value.name),
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: valueTemplateRefKey,
      name: value.name,
      fields: valueFields,
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
