import { PAGE_DESIGNS_ROOT_REF_KEY, pageDesignId, templateId } from "./items/guids";
import { type OperationIr, OperationIrSchema, type SetFieldOp } from "./ir/operations";
import { policyFor } from "./runtime/policy";
import { COMPOSITION_FIELDS } from "./ir/sitecore-templates";
import { type Recipe, RecipeSchema } from "./schema/recipe";
import { encodeTemplatesMapping } from "./layout/templates-mapping";
import { createScaiError } from "@/shared/errors";

import { compileComponentSectionRecipe } from "./compile/component-section";
import { compileComponentTemplateRecipe } from "./compile/component-template";
import { compileContentTemplateRecipe } from "./compile/content-template";
import { compileDesignParametersTemplateRecipe } from "./compile/design-parameters-template";
import { compilePartialDesignRecipe } from "./compile/partial-design";
import { compilePageDesignRecipe } from "./compile/page-design";
import { compilePageTemplateRecipe } from "./compile/page-template";
import { compilePageRecipe } from "./compile/page";
import { compilePlaceholderRecipe } from "./compile/placeholder";
import { compileContentItemRecipe } from "./compile/content-item";
import { compileSiteTemplateRecipe } from "./compile/site-template";
import { compileSiteRecipe } from "./compile/site";
import { compileDictionaryRecipe } from "./compile/dictionary";
import { compileEnumerationRecipe } from "./compile/enumeration";
import { compileWorkflowRecipe } from "./compile/workflow";
import { compileWebhookAuthorizationRecipe } from "./compile/webhook-authorization";
import { compileVariantRecipe } from "./compile/variant";
import { siteOf, type CompileContext } from "./compile/shared";
import { enumerationTemplatesSentinel } from "./compile/enumerations";
import { stableTopologicalSortWithinRanks } from "./compile/ordering";
import {
  AVAILABLE_RENDERINGS_AGGREGATE_HANDLE,
  buildAvailableRenderingsAggregate,
  buildComponentSectionSubtreeOwnershipAggregate,
  buildEnumerationsRootAggregate,
  buildEnumerationTemplatesAggregate,
  buildPlaceholderSettingsAggregate,
  buildSharedDataFolderInsertOptionsAggregate,
  buildSharedDataFoldersAggregate,
  buildSharedFoldersAggregate,
  buildSiteDataRootAggregate,
  COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE,
  detectSharedSubfolders,
  ENUMERATION_TEMPLATES_AGGREGATE_HANDLE,
  ENUMERATIONS_ROOT_AGGREGATE_HANDLE,
  SHARED_FOLDERS_AGGREGATE_HANDLE,
  PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE,
  SHARED_DATA_FOLDER_INSERT_OPTIONS_AGGREGATE_HANDLE,
  SHARED_DATA_FOLDERS_AGGREGATE_HANDLE,
  SITE_DATA_ROOT_AGGREGATE_HANDLE,
  type SharedSubfolderContribution,
} from "./compile/aggregates";
import type {
  ComponentSectionRecipeParsed,
  ComponentTemplateRecipeParsed,
  ContentTemplateRecipeParsed,
  DesignParametersTemplateRecipeParsed,
  EnumerationRecipeParsed,
  SiteRecipeParsed,
} from "./schema/recipe";

// Re-export per-kind compile functions so existing import paths
// (`import { compileComponentTemplateRecipe } from "@/recipe/compile"`)
// keep working.
export {
  compileComponentSectionRecipe,
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  compileDesignParametersTemplateRecipe,
  compilePartialDesignRecipe,
  compilePageDesignRecipe,
  compilePageTemplateRecipe,
  compilePageRecipe,
  compilePlaceholderRecipe,
  compileContentItemRecipe,
  compileSiteTemplateRecipe,
  compileSiteRecipe,
  compileDictionaryRecipe,
  compileEnumerationRecipe,
  compileWorkflowRecipe,
  compileWebhookAuthorizationRecipe,
  compileVariantRecipe,
};

// Re-export the CompileContext type so callers can keep importing it
// from `@/recipe/compile` without reaching into the sub-directory.
export type { CompileContext } from "./compile/shared";

// Re-export the cross-recipe aggregate handle constants. Tests + the
// `./recipe` public entry import these from `@/recipe/compile`; they
// now live alongside the aggregate builders in `./compile/aggregates`.
export {
  AVAILABLE_RENDERINGS_AGGREGATE_HANDLE,
  COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE,
  ENUMERATIONS_ROOT_AGGREGATE_HANDLE,
  PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE,
  SHARED_DATA_FOLDER_INSERT_OPTIONS_AGGREGATE_HANDLE,
  SHARED_DATA_FOLDERS_AGGREGATE_HANDLE,
  SITE_DATA_ROOT_AGGREGATE_HANDLE,
} from "./compile/aggregates";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to
 * materialise the combined `SetField(TemplatesMapping)` write on the
 * Page Designs root. Same `__…__` compiler-synthesized convention as the
 * aggregate handles in `./compile/aggregates`.
 *
 * The convention is load-bearing: author handles match
 * `[a-z][a-z0-9-]*@\d+` so leading underscores are unrepresentable in
 * author input — `__foo__` is reserved for the compiler, greps cleanly
 * in plan output, and gets explicit apply-rank slots below.
 */
export const TEMPLATES_MAPPING_AGGREGATE_HANDLE = "__templates-mapping__";

/** A `handle → recipe` lookup over every recipe of one kind in the set. */
const indexByKind = <K extends Recipe["kind"]>(
  recipes: readonly Recipe[],
  kind: K
): Map<string, Extract<Recipe, { kind: K }>> => {
  const map = new Map<string, Extract<Recipe, { kind: K }>>();
  for (const recipe of recipes) {
    if (recipe.kind === kind) map.set(recipe.handle, recipe as Extract<Recipe, { kind: K }>);
  }
  return map;
};

/**
 * Build the `perRecipeContext` — the base context plus the cross-recipe
 * lookup maps the per-recipe compilers consult (shared subfolders,
 * sections, enums, components, sites). Each map is threaded only when
 * non-empty so the shape stays minimal for standalone compiles.
 */
const buildPerRecipeContext = (
  recipes: readonly Recipe[],
  context: CompileContext,
  sharedSubfolders: ReadonlySet<string>
): CompileContext => {
  const sectionsByHandle = indexByKind(recipes, "component-section") as Map<
    string,
    ComponentSectionRecipeParsed
  >;
  const enumsByHandle = indexByKind(recipes, "enumeration") as Map<string, EnumerationRecipeParsed>;
  const componentsByHandle = indexByKind(recipes, "component-template") as Map<
    string,
    ComponentTemplateRecipeParsed
  >;
  const contentTemplatesByHandle = indexByKind(recipes, "content-template") as Map<
    string,
    ContentTemplateRecipeParsed
  >;
  const parametersByHandle = indexByKind(recipes, "design-parameters-template") as Map<
    string,
    DesignParametersTemplateRecipeParsed
  >;
  const sitesByHandle = indexByKind(recipes, "site") as Map<string, SiteRecipeParsed>;
  return {
    ...context,
    ...(sharedSubfolders.size > 0 ? { sharedSubfolders } : {}),
    ...(sectionsByHandle.size > 0 ? { sectionsByHandle } : {}),
    ...(enumsByHandle.size > 0 ? { enumsByHandle } : {}),
    ...(componentsByHandle.size > 0 ? { componentsByHandle } : {}),
    ...(contentTemplatesByHandle.size > 0 ? { contentTemplatesByHandle } : {}),
    ...(parametersByHandle.size > 0 ? { parametersByHandle } : {}),
    ...(sitesByHandle.size > 0 ? { sitesByHandle } : {}),
  };
};

/**
 * Compile every recipe to its per-recipe IR, keyed by handle.
 *
 * Section recipes are processed FIRST so their rich-fields folder ops
 * seed `emittedFolders` before any component recipe's `ensure*` helpers
 * run — the section folder / renderings section folder / headless
 * variants section then carry the section's icon / displayName /
 * sortOrder rather than the default-folder-icon.
 *
 * The folder-emitting per-kind compilers take `emittedFolders` (so
 * shared group folders only emit once across the whole set); the rest go
 * through the `compileRecipe` front-door.
 */
const compilePerRecipeIrs = (
  recipes: readonly Recipe[],
  perRecipeContext: CompileContext,
  emittedFolders: Set<string>
): Map<string, OperationIr> => {
  const sectionRecipes = recipes.filter((r) => r.kind === "component-section");
  const otherRecipes = recipes.filter((r) => r.kind !== "component-section");
  const orderedRecipes = [...sectionRecipes, ...otherRecipes];

  const irByHandle = new Map<string, OperationIr>();
  for (const recipe of orderedRecipes) {
    irByHandle.set(recipe.handle, compileOneInSet(recipe, perRecipeContext, emittedFolders));
  }
  return irByHandle;
};

/** Compile one recipe within a set — folder-aware kinds get `emittedFolders`. */
const compileOneInSet = (
  recipe: Recipe,
  context: CompileContext,
  emittedFolders: Set<string>
): OperationIr => {
  switch (recipe.kind) {
    case "component-section":
      return compileComponentSectionRecipe(recipe, context, emittedFolders);
    case "component-template":
      return compileComponentTemplateRecipe(recipe, context, emittedFolders);
    case "content-template":
      return compileContentTemplateRecipe(recipe, context, emittedFolders);
    case "content-item":
      // Threads `emittedFolders` so a `folder` shared by several content
      // items materialises its CreateOnly folder ops exactly once per set.
      return compileContentItemRecipe(recipe, context, emittedFolders);
    case "page-template":
      return compilePageTemplateRecipe(recipe, context, emittedFolders);
    case "design-parameters-template":
      return compileDesignParametersTemplateRecipe(recipe, context, emittedFolders);
    case "enumeration":
      return compileEnumerationRecipe(recipe, context, emittedFolders);
    default:
      return compileRecipe(recipe, context);
  }
};

/**
 * Build the combined `SetField(TemplatesMapping)` aggregate IR — one
 * entry per (page design `appliesTo` template) pair, sorted by
 * templateGuid for deterministic output. Returns null when no page
 * design in the set declares `appliesTo`.
 *
 * The field is cross-recipe by nature — every page design contributes
 * one entry per applies-to template, and the field stores the union.
 * Aggregating at compile time keeps the executor untouched (one
 * full-replace write).
 */
const buildTemplatesMappingAggregate = (
  recipes: readonly Recipe[],
  site: string
): OperationIr | null => {
  const entries: { templateGuid: string; designGuid: string }[] = [];
  for (const recipe of recipes) {
    if (recipe.kind !== "page-design" || recipe.appliesTo.length === 0) continue;
    const designGuid = pageDesignId(site, recipe.handle);
    for (const tplHandle of recipe.appliesTo) {
      entries.push({ templateGuid: templateId(site, tplHandle), designGuid });
    }
  }
  if (entries.length === 0) return null;

  entries.sort((a, b) =>
    a.templateGuid === b.templateGuid
      ? a.designGuid.localeCompare(b.designGuid)
      : a.templateGuid.localeCompare(b.templateGuid)
  );

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: TEMPLATES_MAPPING_AGGREGATE_HANDLE,
    operations: [
      {
        op: "SetField",
        policy: policyFor("composition-structure"),
        label: "templates-mapping:aggregate",
        itemRefKey: PAGE_DESIGNS_ROOT_REF_KEY,
        fieldId: COMPOSITION_FIELDS.TEMPLATES_MAPPING,
        value: { kind: "string", value: encodeTemplatesMapping(entries) },
      } satisfies SetFieldOp,
    ],
  });
};

/**
 * Append every cross-recipe aggregate IR (other than the prepended
 * shared-data-folder templates) to `irs` in apply-order.
 *
 * Ordering is load-bearing: each aggregate's `ref-recipe-list` resolves
 * against the captured-itemId map seeded by the per-recipe IRs that ran
 * earlier in the push, so these come AFTER the per-recipe IRs. The
 * component-section ownership prune MUST be last — see the invariant
 * guard in `compileRecipeSet`.
 */
/**
 * The synthetic aggregate handle inventory, split by IR-list position.
 * Consumed by `recipe list --json` so a batch driver knows which handles
 * a `--handles`-scoped push drops and where to re-add them:
 *
 *   - FRONT aggregates compile BEFORE the per-recipe IRs (they create
 *     templates per-recipe items reference via `templateOf`) — a driver
 *     carries them with its FIRST chunk.
 *   - TAIL aggregates compile AFTER (their ref-lists reference per-recipe
 *     items) — a driver pushes them once after every chunk has applied
 *     (or uses `--aggregates-only`).
 *
 * Static inventory, not per-set: a builder may return null for a given
 * set, but pushing an absent handle is a logged no-op, so drivers can
 * pass the full list unconditionally. MUST stay in sync with
 * `compileRecipeSet` / `appendTrailingAggregates` below — the unit test
 * cross-checks membership against the exported aggregate constants.
 */
export const FRONT_AGGREGATE_HANDLES: readonly string[] = [
  SHARED_DATA_FOLDERS_AGGREGATE_HANDLE,
  ENUMERATION_TEMPLATES_AGGREGATE_HANDLE,
  SHARED_FOLDERS_AGGREGATE_HANDLE,
];
export const TAIL_AGGREGATE_HANDLES: readonly string[] = [
  TEMPLATES_MAPPING_AGGREGATE_HANDLE,
  AVAILABLE_RENDERINGS_AGGREGATE_HANDLE,
  SHARED_DATA_FOLDER_INSERT_OPTIONS_AGGREGATE_HANDLE,
  SITE_DATA_ROOT_AGGREGATE_HANDLE,
  ENUMERATIONS_ROOT_AGGREGATE_HANDLE,
  PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE,
  COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE,
];

const appendTrailingAggregates = ({
  irs,
  recipes,
  context,
  setSite,
  shared,
  sharedSubfolders,
}: {
  irs: OperationIr[];
  recipes: readonly Recipe[];
  context: CompileContext;
  setSite: string;
  shared: Map<string, SharedSubfolderContribution[]>;
  sharedSubfolders: ReadonlySet<string>;
}): void => {
  const trailing = [
    buildTemplatesMappingAggregate(recipes, setSite),
    buildAvailableRenderingsAggregate(recipes, context),
    // The shared-data-folder Insert Options run AFTER the per-recipe IRs
    // (they reference each contributing recipe's datasource template); the
    // shared SV they target was created by the prepended template IR.
    buildSharedDataFolderInsertOptionsAggregate(shared, setSite),
    buildSiteDataRootAggregate(recipes, sharedSubfolders, context, setSite),
    buildEnumerationsRootAggregate(recipes, context, setSite),
    buildPlaceholderSettingsAggregate(recipes, context, setSite),
    // Subtree ownership prune — MUST run LAST so every rendering
    // CreateItem op has landed and the captured-itemId map is fully
    // seeded before the planner computes (children − allowedHandles).
    buildComponentSectionSubtreeOwnershipAggregate(recipes, context),
  ];
  for (const ir of trailing) {
    if (ir) irs.push(ir);
  }
};

/**
 * Invariant guard: any IR that emits a PruneChildren op MUST be followed
 * only by IRs that don't create items. Pruning happens last (after the
 * captured-itemId map is fully seeded by every CreateItem in the set); a
 * future aggregate appended below the prune emitter that introduces new
 * CreateItems would corrupt the prune candidate list — the planner reads
 * live children at apply time and would prune items the same push was
 * about to create. Catches the regression at compile time, before any
 * wire call.
 */
const assertPruneOrderingInvariant = (irs: readonly OperationIr[]): void => {
  let firstPruneIrIndex = -1;
  for (let i = 0; i < irs.length; i += 1) {
    if (irs[i].operations.some((op) => op.op === "PruneChildren")) {
      firstPruneIrIndex = i;
      break;
    }
  }
  if (firstPruneIrIndex < 0) return;
  for (let i = firstPruneIrIndex + 1; i < irs.length; i += 1) {
    const offending = irs[i].operations.find((op) => op.op === "CreateItem");
    if (offending) {
      throw createScaiError(
        `Aggregate ordering invariant violated: IR '${irs[i].recipeHandle}' emits a CreateItem after the prune-emitting IR '${irs[firstPruneIrIndex].recipeHandle}' (offending op label: '${offending.label}'). PruneChildren must run LAST in compileRecipeSet — anything that creates items must appear before the prune aggregate.`,
        "UNKNOWN"
      );
    }
  }
};

/**
 * Compile a coherent set of recipes to a list of Operation IRs.
 *
 * Returns one IR per recipe (ordered by cross-recipe apply-rank then
 * intra-rank topo-sort), wrapped by the cross-recipe aggregates: shared
 * Data Folder templates are PREPENDED (so per-recipe folder ITEMs whose
 * `templateOf` is the shared template resolve), and the remaining
 * aggregates (templates-mapping, available-renderings, insert-options
 * roots, placeholder settings, ownership prunes) are APPENDED in
 * apply-order. The prune aggregate runs last; `assertPruneOrderingInvariant`
 * proves it at compile time.
 */
export function compileRecipeSet(
  recipes: readonly Recipe[],
  context: CompileContext
): OperationIr[] {
  const setSite = siteOf(context);

  // Pre-pass: detect site-scoped subfolders shared by ≥2 recipes. Threaded
  // into per-recipe compilation (swaps the folder ITEM's `templateOf` to
  // the shared template) and consumed by the shared-data-folder aggregates.
  const sharedSubfolderContributions = detectSharedSubfolders(recipes, setSite);
  const sharedSubfolders: ReadonlySet<string> = new Set(
    [...sharedSubfolderContributions.keys()].map((k) => k.slice(k.indexOf("::") + 2))
  );

  const perRecipeContext = buildPerRecipeContext(recipes, context, sharedSubfolders);

  // Shared enumeration TEMPLATE trio (templates + `__Standard Values` +
  // Insert Options) — emitted ONCE under the stable
  // `__enumeration-templates__` handle rather than by whichever enum recipe
  // compiles first, so the `__Standard Values` items' tenant ownership
  // marker is deterministic across rebuilds / batched pushes (a drifting
  // owner triggered the "item '__Standard Values' is owned by recipe X, not
  // Y" collision). Built here so the per-recipe sentinel can be pre-seeded
  // BEFORE the per-recipe pass runs.
  const enumerationTemplates = buildEnumerationTemplatesAggregate(recipes, context, setSite);

  // Section-INDEPENDENT shared folders (enum grouping folders + Content
  // Models / Page Templates group folders) — emitted ONCE under the stable
  // `__shared-folders__` handle so a `--handles` chunk missing the arbitrary
  // first-emitter can't leave the executor path-walker to auto-create them
  // (which breaks the enum grouping folder's Insert Options chain). Built
  // here so its refKeys can be pre-seeded before the per-recipe pass.
  const sharedFolders = buildSharedFoldersAggregate(recipes, context, setSite);

  // Shared across the whole set so section / Component Folders /
  // Presentation Parameters group folders only emit once. Pre-seed the
  // enum-templates sentinel + the `__shared-folders__` refKeys so the
  // per-recipe `ensure*` calls resolve refKeys only — the FRONT aggregates
  // above are the sole emitters.
  const emittedFolders = new Set<string>();
  if (enumerationTemplates) emittedFolders.add(enumerationTemplatesSentinel(setSite));
  if (sharedFolders) {
    for (const op of sharedFolders.operations) {
      if (op.op === "CreateItem") emittedFolders.add(op.id);
    }
  }
  const irByHandle = compilePerRecipeIrs(recipes, perRecipeContext, emittedFolders);

  // Order per-recipe IRs by cross-recipe apply-rank, then topologically
  // within each rank, so a referencing recipe always applies AFTER the
  // definitions it points at (page after page template, page design after
  // its partials, site after site template). The sort is stable, so
  // intra-rank emission order for unrelated siblings is unchanged.
  const ranked = stableTopologicalSortWithinRanks(recipes);
  const irs: OperationIr[] = ranked.map((r) => irByHandle.get(r.handle)!);

  // Shared Data Folder TEMPLATE creation must run BEFORE the per-recipe
  // IRs: each recipe's `site-data-folder` folder ITEM is created with
  // `templateOf = sharedDataFolderTemplateId(...)`, so the template must
  // already exist or Authoring GraphQL aborts. Prepend it.
  const sharedDataFolderTemplates = buildSharedDataFoldersAggregate(
    sharedSubfolderContributions,
    context,
    setSite
  );
  if (sharedDataFolderTemplates) irs.unshift(sharedDataFolderTemplates);

  // Shared organisational folders: FRONT (per-recipe items nest under them
  // via `parent`). Unshifted BEFORE the enum-templates trio so the final
  // order is [enum-templates, shared-folders, …] — the enum grouping folders
  // conform to the `Enumerations Folder` template the trio creates, so the
  // trio must apply first.
  if (sharedFolders) irs.unshift(sharedFolders);

  // Enum TEMPLATE trio: same FRONT-ordering requirement as the shared Data
  // Folder templates — per-recipe enum items reference these via
  // `templateOf`, so they must exist before any per-recipe IR applies.
  if (enumerationTemplates) irs.unshift(enumerationTemplates);

  appendTrailingAggregates({
    irs,
    recipes,
    context,
    setSite,
    shared: sharedSubfolderContributions,
    sharedSubfolders,
  });

  assertPruneOrderingInvariant(irs);

  return irs;
}

/** Front-door dispatcher — accepts any registered recipe kind. */
export function compileRecipe(input: Recipe, context: CompileContext): OperationIr {
  const recipe = RecipeSchema.parse(input);
  switch (recipe.kind) {
    case "component-section":
      return compileComponentSectionRecipe(recipe, context);
    case "component-template":
      return compileComponentTemplateRecipe(recipe, context);
    case "content-template":
      return compileContentTemplateRecipe(recipe, context);
    case "content-item":
      return compileContentItemRecipe(recipe, context);
    case "page-template":
      return compilePageTemplateRecipe(recipe, context);
    case "page":
      return compilePageRecipe(recipe, context);
    case "placeholder":
      return compilePlaceholderRecipe(recipe, context);
    case "design-parameters-template":
      return compileDesignParametersTemplateRecipe(recipe, context);
    case "partial-design":
      return compilePartialDesignRecipe(recipe, context);
    case "page-design":
      return compilePageDesignRecipe(recipe, context);
    case "site-template":
      return compileSiteTemplateRecipe(recipe, context);
    case "site":
      return compileSiteRecipe(recipe, context);
    case "dictionary":
      return compileDictionaryRecipe(recipe, context);
    case "enumeration":
      return compileEnumerationRecipe(recipe, context);
    case "workflow":
      return compileWorkflowRecipe(recipe, context);
    case "webhook-authorization":
      return compileWebhookAuthorizationRecipe(recipe, context);
    case "variant":
      return compileVariantRecipe(recipe, context);
  }
}
