import { promises as fs } from "node:fs";
import path from "node:path";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import { compileRecipeSet } from "../compile";
import { loadRecipe } from "../io";
import { readCurrentRecipes, type ReadCurrentRoots } from "../items/read-current";
import { collectBaselineEntries } from "../runtime/baseline-capture";
import { FileBaselineStorage } from "../runtime/baseline";
import type { OperationIr } from "../ir/operations";
import type {
  ComponentTemplateRecipeParsed,
  ContentItemRecipeParsed,
  ContentTemplateRecipeParsed,
  PageRecipeParsed,
  PageTemplateRecipeParsed,
  Recipe,
} from "../schema/recipe";
import {
  recipeSetNeedsRoots,
  resolveRecipeInputs,
  resolveRecipeRoots,
  resolveSeedSite,
  resolveTenant,
  toLogger,
  type RecipeTenantOptions,
} from "./shared";
import {
  humanizeFieldKey,
  mergeContentValueRecipe,
  mergeTemplateRecipe,
  perFieldStatuses,
  rollupPerFieldStatuses,
  rollupTemplateStatuses,
  type FieldMergeStatus,
  type PerFieldStatuses,
  type RecipeMergeStatus,
} from "./pull-merge";
import { composeMergePlan, loadMergePlan, type MergePlan } from "./pull-merge-plan";
import { assertWithinDir, detectStalePlanDrift } from "./pull-drift";

export { MergePlanFieldSchema, MergePlanRecipeSchema, MergePlanSchema } from "./pull-merge-plan";
export type { MergePlan, MergePlanField, MergePlanRecipe } from "./pull-merge-plan";
export { loadMergePlan, composeMergePlan } from "./pull-merge-plan";
export {
  classifyMergeStatus,
  perFieldStatuses,
  mergeContentValueRecipe,
  mergeTemplateRecipe,
} from "./pull-merge";
export type { RecipeMergeStatus, FieldMergeStatus, PerFieldStatuses } from "./pull-merge";
export { detectStalePlanDrift, assertWithinDir } from "./pull-drift";

/**
 * `scai provision recipe pull` — read tenant state and serialise every
 * reverse-projectable recipe to disk as `.recipe.json`.
 *
 * Two modes:
 *
 * ## Snapshot mode (default)
 *
 *   <outDir>/<kind>/<slug(handle)>.recipe.json
 *
 * Read-only against authored sources. Pull overwrites whatever's in
 * `<outDir>` but never touches the authored recipes directory. Useful
 * for backup / inspection / generating starter content.
 *
 * ## Merge mode (`--against <recipes-dir>`)
 *
 * Reads the authored recipes from `<recipes-dir>`, compiles both sides
 * (disk + tenant projection) through `compileRecipeSet`, hashes per
 * field via `collectBaselineEntries`, and classifies each recipe:
 *
 *   in-sync       disk + tenant agree (and match baseline if loaded)
 *   disk-ahead    disk has changes the tenant hasn't seen yet → push
 *   tenant-edited author edited tenant in the CMS since last push
 *   conflict      both sides moved since baseline → operator picks
 *   disk-only     recipe on disk, absent on tenant (deleted or never pushed)
 *   tenant-only   recipe on tenant, absent on disk (authored in CMS only)
 *
 * `--policy` governs the CLI exit code + per-recipe write:
 *   error (default) — exit non-zero if any `tenant-edited` or `conflict`
 *   disk-wins       — skip writes for recipes where the disk has changes;
 *                     pull only `in-sync` / `tenant-only` / `tenant-edited`
 *   tenant-wins     — always write tenant projection (operator accepts
 *                     adoption — still to outDir, never overwrites the
 *                     authored .recipe.ts source)
 *
 * The 10 reverse-projectable kinds (component-section, component-template,
 * content-template, page-template, enumeration, partial-design,
 * page-design, page, placeholder, content-item) round-trip; see
 * `read-current.ts` for the per-kind fidelity notes.
 */

export interface RecipePullOptions extends RecipeTenantOptions {
  /** Output directory for serialised tenant recipes. Defaults to `./pulled-recipes`. */
  output?: string;
  /**
   * Merge mode: path to the authored recipes directory (typically
   * `./recipes` or the glob resolved by `sitecoreai.cli.json`). When
   * unset (default), pull runs in snapshot mode — overwrites `<outDir>`
   * with no merge detection. When set, pull compares the tenant
   * projection against the disk recipes + baseline and classifies each
   * recipe per `RecipeMergeStatus`.
   *
   * Use `--against .` to pick up the default `recipes` glob from
   * `sitecoreai.cli.json` (resolveRecipeInputs reads the config).
   */
  against?: string;
  /**
   * Merge-mode conflict policy (only used when `--against` is set):
   *   - `"error"` (default) — exit non-zero on tenant-edited / conflict
   *   - `"disk-wins"`       — skip writes for recipes with disk changes
   *   - `"tenant-wins"`     — write every tenant projection regardless
   *
   * Mirrors push's `--conflict-policy` semantics, direction-inverted.
   */
  conflictPolicy?: "error" | "disk-wins" | "tenant-wins";
  /**
   * Skip three-way merge baseline loading. Without a baseline the
   * planner falls back to two-way diff (any divergence reads as
   * `conflict` since we can't tell who moved). Mirrors push's
   * `--no-baseline`.
   */
  noBaseline?: boolean;
  /**
   * Path to write a merge-plan JSON file. Plan is a hand-editable
   * snapshot of every per-recipe per-field classification + the
   * pre-filled winner pick per the current `--conflict-policy`.
   * Operator edits the `winner` entries then re-runs pull with
   * `--apply-plan <same-path>` to commit their picks. Implies merge
   * mode (`--against` must be set). Doesn't write the synthesised
   * recipes — that's `--apply-plan`'s job.
   */
  writePlan?: string;
  /**
   * Path to read a merge-plan JSON file from. Pull rebuilds
   * classifications fresh, verifies each plan entry's status still
   * matches the current tenant + disk state, then synthesises merged
   * recipes using the plan's `winner` picks per field. Refuses to apply
   * if the env doesn't match, any plan entry's classification has
   * drifted, or the plan references recipes the current set doesn't
   * have — the operator must regenerate.
   */
  applyPlan?: string;
  /**
   * Test-only injection for the plan's `generatedAt` timestamp. When
   * unset, the writer stamps `new Date().toISOString()`. Tests pin a
   * value so the plan output is byte-stable.
   */
  now?: string;
  /**
   * Dry-run: classify + report what WOULD be written, but skip every
   * file write (recipe JSON files, merge plan, baseline reads still
   * happen). Useful in CI for verifying tenant + disk are in sync
   * without leaving any artifacts on the runner FS. Result still
   * carries `files` entries with `path: null` for entries that would
   * have been written.
   */
  dryRun?: boolean;
  /** Override `templatesRoot` from the env profile. */
  templatesRoot?: string;
  /** Override `renderingsRoot` from the env profile. */
  renderingsRoot?: string;
  /** Override `componentsRoot` from the env profile. */
  componentsRoot?: string;
  /** Override `contentModelsRoot` from the env profile. */
  contentModelsRoot?: string;
  /** Override `pageTemplatesRoot` from the env profile. */
  pageTemplatesRoot?: string;
  /** Override `partialDesignsRoot` from the env profile. */
  partialDesignsRoot?: string;
  /** Override `pageDesignsRoot` from the env profile. */
  pageDesignsRoot?: string;
  /** Override `pagesRoot` from the env profile. */
  pagesRoot?: string;
  /** Override `enumerationsRoot` from the env profile. */
  enumerationsRoot?: string;
  /** Override `placeholderSettingsRoot` from the env profile. */
  placeholderSettingsRoot?: string;
  /** Override `contentItemsRoot` from the env profile. */
  contentItemsRoot?: string;
}

/** Per-recipe outcome — file written (if any) + merge status. */
export interface RecipePullEntry {
  handle: string;
  kind: string;
  /** Filesystem path of the written `.recipe.json`. `null` when skipped. */
  path: string | null;
  /** Merge classification. `"in-sync"` is also used in snapshot mode for every recipe. */
  status: RecipeMergeStatus;
  /**
   * Number of fields whose hash changed on each side relative to the
   * baseline. Only populated in merge mode; both `0` outside it.
   */
  diskChangedFields?: number;
  tenantChangedFields?: number;
  /**
   * Per-field classifications keyed by humanised label
   * (`fieldName (lang, v#)` or `fieldName` for shared fields). Surfaced
   * so JSON consumers + verbose human output can inspect WHICH fields
   * moved on which side. Only populated in merge mode.
   */
  fieldStatuses?: Array<{ key: string; status: FieldMergeStatus }>;
}

export interface RecipePullResult {
  outputDir: string;
  totalRecipes: number;
  byKind: Record<string, number>;
  byStatus: Record<RecipeMergeStatus, number>;
  files: RecipePullEntry[];
  /**
   * True when the operator passed `--against` AND `--policy=error` AND
   * any recipe classified as `tenant-edited` or `conflict`. The CLI
   * layer surfaces this as exit non-zero.
   */
  blocked: boolean;
}

const slugifyHandle = (handle: string): string => handle.replace(/@/g, "_v");

/**
 * Optional content-tree roots: each is included in `ReadCurrentRoots`
 * only when set on the CLI options OR the env profile (so `read-current`
 * can distinguish "unset" from an explicit empty string). `templatesRoot`
 * + `renderingsRoot` are required and default to `""`; everything else
 * is data-driven here so adding a root is a one-line list edit.
 */
const OPTIONAL_ROOT_KEYS = [
  "componentsRoot",
  "contentModelsRoot",
  "pageTemplatesRoot",
  "partialDesignsRoot",
  "pageDesignsRoot",
  "pagesRoot",
  "enumerationsRoot",
  "placeholderSettingsRoot",
  "contentItemsRoot",
] as const;

type OptionalRootKey = (typeof OPTIONAL_ROOT_KEYS)[number];
type RootSource = Partial<Record<OptionalRootKey | "templatesRoot" | "renderingsRoot", string>>;

const resolveRoots = (options: RecipePullOptions, environment: RootSource): ReadCurrentRoots => {
  const roots: ReadCurrentRoots = {
    templatesRoot: options.templatesRoot ?? environment.templatesRoot ?? "",
    renderingsRoot: options.renderingsRoot ?? environment.renderingsRoot ?? "",
  };
  for (const key of OPTIONAL_ROOT_KEYS) {
    const resolved = options[key] ?? environment[key];
    if (resolved !== undefined) roots[key] = resolved;
  }
  return roots;
};

/**
 * Build a `(itemRefKey, fieldKey) → hash` map from a list of baseline
 * entries — the wire form `collectBaselineEntries` produces from any IR.
 * Mirrors `baseline.ts`'s `baselineLookupKey` so disk + tenant + baseline
 * indexes share keys.
 */
const indexHashes = (
  entries: ReadonlyArray<{
    itemRefKey: string;
    fieldId: string;
    fieldName?: string;
    language?: string;
    version?: number;
    valueHash: string;
  }>
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const e of entries) {
    const idPart =
      e.fieldName !== undefined
        ? `name:${e.fieldName.toLowerCase()}`
        : `id:${e.fieldId.toLowerCase()}`;
    const key = `${e.itemRefKey.toLowerCase()}|${idPart}|${e.language ?? ""}|${e.version ?? ""}`;
    out.set(key, e.valueHash);
  }
  return out;
};

/**
 * The label every CreateItem op for the main content-item / page item
 * carries — produced by `compileContentItemRecipe` (`content-item:<handle>`)
 * and `compilePageRecipe` (`page:<handle>`). Used to recover the IR's
 * `itemRefKey` for the main item without re-computing site-aware GUIDs
 * here — the IR already has the canonical value.
 */
const findMainItemRefKey = (ir: OperationIr, kind: "content-item" | "page"): string | undefined => {
  const label = `${kind}:${ir.recipeHandle}`;
  for (const op of ir.operations) {
    if (op.op === "CreateItem" && op.label === label) return op.id;
  }
  return undefined;
};

/**
 * Atomic write helper — temp file in the same directory, then rename.
 * A concurrent reader sees either the old file or the new one, never a
 * half-written truncation. Process crash mid-write leaves the original
 * untouched (rename hasn't happened yet); crash after rename leaves
 * the new file fully written. Used for every file scai's pull task
 * lands on the operator's FS.
 */
const writeFileAtomic = async (filePath: string, contents: string): Promise<void> => {
  const tmpPath = `${filePath}.${process.pid}.${Math.floor(Math.random() * 1e9)}.tmp`;
  await fs.writeFile(tmpPath, contents, "utf8");
  await fs.rename(tmpPath, filePath);
};

/**
 * Serialise one Recipe to disk as `<outDir>/<kind>/<slug>.recipe.json`.
 * Creates the per-kind directory on demand.
 */
const writeRecipeJson = async (
  outDir: string,
  recipe: Recipe & { handle: string }
): Promise<string> => {
  const kindDir = path.join(outDir, recipe.kind);
  const filePath = path.join(kindDir, `${slugifyHandle(recipe.handle)}.recipe.json`);
  // Defensive against a path-traversal regression: handleOf in
  // read-current.ts validates the tenant-stamped marker, but a second
  // line of defence here catches any future identity-string source
  // that forgets to sanitise.
  assertWithinDir(outDir, filePath);
  await fs.mkdir(kindDir, { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(recipe, null, 2)}\n`);
  return filePath;
};

/**
 * Snapshot mode (no `--against`): no disk discovery, no classification —
 * just dump every tenant recipe to `<outDir>/<kind>/`. Every entry gets
 * status "in-sync" so the result shape stays uniform across modes.
 */
const runSnapshotMode = async (args: {
  tenantRecipes: readonly Recipe[];
  outputDir: string;
  dryRun: boolean;
  byStatus: Record<RecipeMergeStatus, number>;
  envName: string;
  logger: ReturnType<typeof toLogger>;
}): Promise<RecipePullResult> => {
  const { tenantRecipes, outputDir, dryRun, byStatus, envName, logger } = args;
  const files: RecipePullEntry[] = [];
  const byKind: Record<string, number> = {};
  for (const recipe of tenantRecipes) {
    const filePath = dryRun
      ? null
      : await writeRecipeJson(outputDir, recipe as Recipe & { handle: string });
    files.push({
      handle: (recipe as { handle: string }).handle,
      kind: recipe.kind,
      path: filePath,
      status: "in-sync",
    });
    byKind[recipe.kind] = (byKind[recipe.kind] ?? 0) + 1;
    byStatus["in-sync"] += 1;
  }
  const result: RecipePullResult = {
    outputDir,
    totalRecipes: tenantRecipes.length,
    byKind,
    byStatus,
    files,
    blocked: false,
  };
  if (logger.isJson()) {
    logger.json({ command: "recipe.pull", environment: envName, ...result });
    return result;
  }
  logger.info(`Pulled ${result.totalRecipes} recipes from ${envName} to ${outputDir}`, "cyan");
  for (const [kind, count] of Object.entries(result.byKind).sort()) {
    logger.info(`  ${kind}: ${count}`);
  }
  if (result.totalRecipes === 0) {
    logger.info(
      "  (no recipes recovered — verify env-profile roots and that tenant items carry the SCAI Handle marker)",
      "yellow"
    );
  }
  return result;
};

/**
 * Detect cross-kind collisions on one side and build the handle→Recipe
 * lookup the merge loop re-emits from. Two recipes on the same side sharing
 * a handle but differing in kind would silently overwrite each other and the
 * merge loop would later fall through to a tenant write with no diagnostic
 * (last-write-wins). Throw `INPUT_INVALID` so the operator sees the collision
 * before any file is written.
 */
const buildRecipeByHandle = (
  label: "disk" | "tenant",
  list: readonly Recipe[]
): Map<string, Recipe> => {
  const out = new Map<string, Recipe>();
  for (const r of list) {
    const handle = (r as { handle: string }).handle;
    const existing = out.get(handle);
    if (existing && existing.kind !== r.kind) {
      throw createScaiError(
        `Handle collision on ${label}: '${handle}' appears as both ${existing.kind} and ${r.kind}.`,
        "INPUT_INVALID",
        {
          hint: "Recipe handles must be unique per side. Rename one of the colliding recipes (or merge them) and re-run.",
        }
      );
    }
    out.set(handle, r);
  }
  return out;
};

/**
 * Cross-side kind check: the same handle on both sides MUST resolve to the
 * same kind for the synthesis path to make sense. Different kinds would fall
 * through to the else-branch (write tenant) silently — surface as an error.
 */
const assertCrossSideKinds = (
  diskRecipeByHandle: ReadonlyMap<string, Recipe>,
  tenantRecipeByHandle: ReadonlyMap<string, Recipe>
): void => {
  for (const [handle, diskRecipe] of diskRecipeByHandle) {
    const tenantRecipe = tenantRecipeByHandle.get(handle);
    if (tenantRecipe !== undefined && tenantRecipe.kind !== diskRecipe.kind) {
      throw createScaiError(
        `Cross-side kind mismatch for handle '${handle}': disk is ${diskRecipe.kind}, tenant is ${tenantRecipe.kind}.`,
        "INPUT_INVALID",
        {
          hint: "The same handle must resolve to the same kind on both sides. One side may have been authored against an older schema, or two recipes accidentally share a handle.",
        }
      );
    }
  }
};

/**
 * Roll up structural presence + per-field statuses into the recipe-level
 * status. Disk-only / tenant-only short-circuit (one side has no fields to
 * compare); otherwise defer to `rollupPerFieldStatuses`.
 */
const classifyRecipeStatus = (
  diskHashes: Map<string, string> | null,
  tenantHashes: Map<string, string> | null,
  fieldStatuses: PerFieldStatuses
): { status: RecipeMergeStatus; diskChanged: number; tenantChanged: number } => {
  if (diskHashes === null && tenantHashes === null) {
    return { status: "in-sync", diskChanged: 0, tenantChanged: 0 };
  }
  if (diskHashes === null) {
    return { status: "tenant-only", diskChanged: 0, tenantChanged: 0 };
  }
  if (tenantHashes === null) {
    return { status: "disk-only", diskChanged: 0, tenantChanged: 0 };
  }
  const rolled = rollupPerFieldStatuses(fieldStatuses);
  return {
    status: rolled.status,
    diskChanged: rolled.diskChanged,
    tenantChanged: rolled.tenantChanged,
  };
};

/**
 * Decide whether to write a recipe file for one handle given the policy /
 * apply-plan mode and the recipe's classification.
 */
const shouldWriteRecipe = (args: {
  appliedPlan: MergePlan | null;
  policy: "error" | "disk-wins" | "tenant-wins";
  status: RecipeMergeStatus;
  diskRecipe: Recipe | undefined;
  tenantRecipe: Recipe | undefined;
}): boolean => {
  const { appliedPlan, policy, status, diskRecipe, tenantRecipe } = args;
  if (!tenantRecipe && !diskRecipe) return false;
  // Apply-plan mode always writes — the plan IS the policy.
  if (appliedPlan !== null) return true;
  switch (policy) {
    case "tenant-wins":
      // Always emit a recipe file — either tenant-only, or a per-field
      // merge synthesized below.
      return tenantRecipe !== undefined || diskRecipe !== undefined;
    case "disk-wins":
      // Only write when the disk side has no changes (in-sync or
      // tenant-only or tenant-edited cases). Skip disk-ahead +
      // conflict so the operator's local recipe stays the source of
      // truth in the output directory.
      return (
        tenantRecipe !== undefined &&
        (status === "in-sync" || status === "tenant-only" || status === "tenant-edited")
      );
    case "error":
    default:
      // Default policy: write `in-sync` + `tenant-only` (safe), skip
      // anything that needs operator attention so the file list
      // reflects what's actually been merged.
      return tenantRecipe !== undefined && (status === "in-sync" || status === "tenant-only");
  }
};

/**
 * Apply-plan staleness verification: compare each plan-recorded field status
 * to the current classification. A mismatch means the world moved between
 * write-plan + apply-plan; applying the stale plan could clobber a fresh
 * edit, so throw and ask the operator to regenerate.
 */
const assertPlanNotStale = (args: {
  appliedPlan: MergePlan | null;
  overridesForRecipe: Map<string, "disk" | "tenant"> | undefined;
  handle: string;
  tenantRecipe: Recipe | undefined;
  diskRecipe: Recipe | undefined;
  fieldStatuses: PerFieldStatuses;
  tenantIrByHandle: ReadonlyMap<string, OperationIr>;
  diskIrByHandle: ReadonlyMap<string, OperationIr>;
}): void => {
  const {
    appliedPlan,
    overridesForRecipe,
    handle,
    tenantRecipe,
    diskRecipe,
    fieldStatuses,
    tenantIrByHandle,
    diskIrByHandle,
  } = args;
  if (appliedPlan === null || overridesForRecipe === undefined) return;
  const planEntry = appliedPlan.recipes.find((r) => r.handle === handle);
  if (planEntry === undefined) return;
  const planEntryKind = (tenantRecipe ?? diskRecipe)?.kind;
  // Templates compare against the rolled-up statuses (one per field);
  // content kinds compare against raw fieldStatuses.
  const compareStatuses = ((): PerFieldStatuses => {
    if (
      planEntryKind === "component-template" ||
      planEntryKind === "content-template" ||
      planEntryKind === "page-template"
    ) {
      const ir = tenantIrByHandle.get(handle) ?? diskIrByHandle.get(handle);
      return ir ? rollupTemplateStatuses(fieldStatuses, ir).statuses : fieldStatuses;
    }
    return fieldStatuses;
  })();
  const drifted = detectStalePlanDrift(planEntry, compareStatuses);
  if (drifted.length > 0) {
    throw createScaiError(
      `Stale merge plan for recipe '${handle}': ${drifted.length} field(s) classify differently now than when the plan was generated.`,
      "INPUT_INVALID",
      {
        hint: "The world moved between --write-plan and --apply-plan. Regenerate the plan (`recipe pull --against ... --write-plan ...`) to see the new state and re-pick winners.",
        details: drifted,
      }
    );
  }
};

/**
 * Pick the Recipe to write for one handle under the effective policy:
 *   disk-wins   prefer disk whole (falls back to tenant when absent)
 *   tenant-wins per-field merge for content + template kinds; other kinds
 *               fall through to tenant whole
 *   error       only in-sync + tenant-only reach here — tenant is correct
 */
const selectRecipeToWrite = (args: {
  effectivePolicy: "error" | "disk-wins" | "tenant-wins";
  handle: string;
  diskRecipe: Recipe | undefined;
  tenantRecipe: Recipe | undefined;
  fieldStatuses: PerFieldStatuses;
  overridesForRecipe: Map<string, "disk" | "tenant"> | undefined;
  tenantIrByHandle: ReadonlyMap<string, OperationIr>;
  diskIrByHandle: ReadonlyMap<string, OperationIr>;
}): Recipe => {
  const {
    effectivePolicy,
    handle,
    diskRecipe,
    tenantRecipe,
    fieldStatuses,
    overridesForRecipe,
    tenantIrByHandle,
    diskIrByHandle,
  } = args;
  if (effectivePolicy === "disk-wins") {
    return (diskRecipe ?? tenantRecipe)!;
  }
  if (
    effectivePolicy === "tenant-wins" &&
    diskRecipe !== undefined &&
    tenantRecipe !== undefined &&
    (tenantRecipe.kind === "content-item" || tenantRecipe.kind === "page") &&
    diskRecipe.kind === tenantRecipe.kind
  ) {
    const tenantIr = tenantIrByHandle.get(handle);
    const mainRefKey = tenantIr ? findMainItemRefKey(tenantIr, tenantRecipe.kind) : undefined;
    return mergeContentValueRecipe(
      diskRecipe as ContentItemRecipeParsed | PageRecipeParsed,
      tenantRecipe as ContentItemRecipeParsed | PageRecipeParsed,
      fieldStatuses,
      mainRefKey,
      overridesForRecipe
    );
  }
  if (
    effectivePolicy === "tenant-wins" &&
    diskRecipe !== undefined &&
    tenantRecipe !== undefined &&
    (tenantRecipe.kind === "component-template" ||
      tenantRecipe.kind === "content-template" ||
      tenantRecipe.kind === "page-template") &&
    diskRecipe.kind === tenantRecipe.kind
  ) {
    // Template-style recipes: per-field merge matches by field name
    // (FieldDefinition is the merge unit, not its sub-properties).
    const diskIr = diskIrByHandle.get(handle);
    const tenantIr = tenantIrByHandle.get(handle);
    if (diskIr !== undefined && tenantIr !== undefined) {
      return mergeTemplateRecipe({
        diskRecipe: diskRecipe as
          ComponentTemplateRecipeParsed | ContentTemplateRecipeParsed | PageTemplateRecipeParsed,
        tenantRecipe: tenantRecipe as
          ComponentTemplateRecipeParsed | ContentTemplateRecipeParsed | PageTemplateRecipeParsed,
        statuses: fieldStatuses,
        diskIr,
        tenantIr,
        winnerOverrides: overridesForRecipe,
      });
    }
    // Defensive: IR missing for one side → fall back to tenant.
    return tenantRecipe;
  }
  return (tenantRecipe ?? diskRecipe)!;
};

/**
 * Build the merge-plan source entry for one handle. Templates need their
 * per-property statuses rolled up to one entry per field (so plan +
 * `mergeTemplateRecipe.winnerFor` agree on the key shape); content kinds use
 * the raw field-level map.
 */
const buildPlanSourceEntry = ({
  handle,
  kind,
  status,
  fieldStatuses,
  tenantIrByHandle,
  diskIrByHandle,
}: {
  handle: string;
  kind: string;
  status: RecipeMergeStatus;
  fieldStatuses: PerFieldStatuses;
  tenantIrByHandle: ReadonlyMap<string, OperationIr>;
  diskIrByHandle: ReadonlyMap<string, OperationIr>;
}): {
  handle: string;
  kind: string;
  rollupStatus: RecipeMergeStatus;
  fieldStatuses: PerFieldStatuses;
  labels?: Map<string, string>;
} => {
  if (kind === "component-template" || kind === "content-template" || kind === "page-template") {
    const ir = tenantIrByHandle.get(handle) ?? diskIrByHandle.get(handle);
    if (ir !== undefined) {
      const { statuses: rolled, labels } = rollupTemplateStatuses(fieldStatuses, ir);
      return { handle, kind, rollupStatus: status, fieldStatuses: rolled, labels };
    }
  }
  return { handle, kind, rollupStatus: status, fieldStatuses };
};

/**
 * Load + validate the merge plan when `--apply-plan` is set, and build the
 * per-(recipe, field) winner-override map. The plan's environment must match
 * the current run's env (a plan generated against staging shouldn't apply to
 * prod). Returns the loaded plan (or null) and the override map.
 */
const loadAppliedPlan = async (
  options: RecipePullOptions,
  envName: string,
  winnerOverridesByHandle: Map<string, Map<string, "disk" | "tenant">>
): Promise<MergePlan | null> => {
  if (options.applyPlan === undefined) return null;
  const appliedPlan = await loadMergePlan(options.applyPlan);
  if (appliedPlan.environment !== envName) {
    throw createScaiError(
      `Merge plan was generated against environment '${appliedPlan.environment}' but pull is running against '${envName}'.`,
      "INPUT_INVALID",
      {
        hint: "Regenerate the plan against the current environment (`recipe pull --against ... --write-plan ...`) or run pull against the matching env.",
      }
    );
  }
  for (const recipeEntry of appliedPlan.recipes) {
    const overrides = new Map<string, "disk" | "tenant">();
    for (const field of recipeEntry.fields) {
      overrides.set(field.rawKey.toLowerCase(), field.winner);
    }
    winnerOverridesByHandle.set(recipeEntry.handle, overrides);
  }
  return appliedPlan;
};

/**
 * Apply-plan completeness check: every plan-referenced recipe must be in the
 * current run. A plan entry whose handle disappeared (operator deleted the
 * recipe, or pull is running against a different set) means the plan is
 * stale; refuse to apply it. Extra recipes not in the plan are fine.
 */
const assertPlanRecipesPresent = (
  appliedPlan: MergePlan | null,
  allHandles: ReadonlySet<string>
): void => {
  if (appliedPlan === null) return;
  const missingFromCurrent = appliedPlan.recipes
    .map((r) => r.handle)
    .filter((h) => !allHandles.has(h));
  if (missingFromCurrent.length > 0) {
    throw createScaiError(
      `Merge plan references ${missingFromCurrent.length} recipe(s) that aren't in the current set.`,
      "INPUT_INVALID",
      {
        hint: "Regenerate the plan (`recipe pull --against ... --write-plan ...`) — the recipe set has changed since the plan was written.",
        details: missingFromCurrent.map(
          (h) => `Plan handle '${h}' not found in current disk + tenant set.`
        ),
      }
    );
  }
};

/**
 * Resolve the on-disk path written for one handle: short-circuits to `null`
 * when nothing should be written, otherwise verifies plan freshness, selects
 * the recipe to write under the effective policy, and writes it (unless
 * dry-run). Returns `null` in dry-run even when a write would occur.
 */
const resolveRecipeFilePath = async (args: {
  shouldWrite: boolean;
  appliedPlan: MergePlan | null;
  policy: "error" | "disk-wins" | "tenant-wins";
  handle: string;
  diskRecipe: Recipe | undefined;
  tenantRecipe: Recipe | undefined;
  fieldStatuses: PerFieldStatuses;
  winnerOverridesByHandle: ReadonlyMap<string, Map<string, "disk" | "tenant">>;
  tenantIrByHandle: ReadonlyMap<string, OperationIr>;
  diskIrByHandle: ReadonlyMap<string, OperationIr>;
  dryRun: boolean;
  outputDir: string;
}): Promise<string | null> => {
  const {
    shouldWrite,
    appliedPlan,
    policy,
    handle,
    diskRecipe,
    tenantRecipe,
    fieldStatuses,
    winnerOverridesByHandle,
    tenantIrByHandle,
    diskIrByHandle,
    dryRun,
    outputDir,
  } = args;
  if (!shouldWrite) return null;
  // Operator-supplied per-(rawKey) overrides from --apply-plan (if any).
  // When `applyPlan` is set + this recipe is in the plan, the overrides win
  // per-field; otherwise the policy default applies.
  const overridesForRecipe = winnerOverridesByHandle.get(handle);
  // Staleness verification: refuse to apply a plan whose classifications
  // drifted since it was written (could clobber a fresh edit).
  assertPlanNotStale({
    appliedPlan,
    overridesForRecipe,
    handle,
    tenantRecipe,
    diskRecipe,
    fieldStatuses,
    tenantIrByHandle,
    diskIrByHandle,
  });
  // Apply-plan mode forces the per-field merge path (tenant-wins synthesis)
  // regardless of conflictPolicy — the plan IS the policy.
  const effectivePolicy: "error" | "disk-wins" | "tenant-wins" =
    appliedPlan !== null ? "tenant-wins" : policy;
  const recipeToWrite = selectRecipeToWrite({
    effectivePolicy,
    handle,
    diskRecipe,
    tenantRecipe,
    fieldStatuses,
    overridesForRecipe,
    tenantIrByHandle,
    diskIrByHandle,
  });
  return dryRun ? null : writeRecipeJson(outputDir, recipeToWrite as Recipe & { handle: string });
};

/**
 * Classify one handle in merge mode and produce its result entry,
 * plan-source entry, and CLI error-gate verdict. Extracted from
 * `runRecipePull`'s per-handle loop so the body stays a thin
 * accumulate-into-arrays pass.
 */
interface ClassifyHandleArgs {
  handle: string;
  diskRecipeByHandle: ReadonlyMap<string, Recipe>;
  tenantRecipeByHandle: ReadonlyMap<string, Recipe>;
  diskHashByHandle: ReadonlyMap<string, Map<string, string>>;
  tenantHashByHandle: ReadonlyMap<string, Map<string, string>>;
  baselineHashesByHandle: ReadonlyMap<string, Map<string, string> | null>;
  appliedPlan: MergePlan | null;
  policy: "error" | "disk-wins" | "tenant-wins";
  winnerOverridesByHandle: ReadonlyMap<string, Map<string, "disk" | "tenant">>;
  tenantIrByHandle: ReadonlyMap<string, OperationIr>;
  diskIrByHandle: ReadonlyMap<string, OperationIr>;
  dryRun: boolean;
  outputDir: string;
}

interface ClassifyHandleOutcome {
  kind: string;
  entry: RecipePullEntry;
  planSourceEntry: {
    handle: string;
    kind: string;
    rollupStatus: RecipeMergeStatus;
    fieldStatuses: PerFieldStatuses;
    labels?: Map<string, string>;
  };
  blocked: boolean;
}

const classifyHandle = async (args: ClassifyHandleArgs): Promise<ClassifyHandleOutcome> => {
  const { handle, appliedPlan, policy, dryRun, outputDir } = args;
  const diskRecipe = args.diskRecipeByHandle.get(handle);
  const tenantRecipe = args.tenantRecipeByHandle.get(handle);
  const diskHashes = args.diskHashByHandle.get(handle) ?? null;
  const tenantHashes = args.tenantHashByHandle.get(handle) ?? null;
  const baselineHashes = args.baselineHashesByHandle.get(handle) ?? null;

  // Per-field statuses first, then roll up. Both sides of the diff share
  // the same status; the rollup gates write decisions + the CLI error
  // gate, the per-field map drives the tenant-wins merge synthesis.
  const fieldStatuses = perFieldStatuses(diskHashes, tenantHashes, baselineHashes);

  // Disk-only / tenant-only short-circuits — these aren't per-field
  // classifiable since one side has no fields to compare to.
  const { status, diskChanged, tenantChanged } = classifyRecipeStatus(
    diskHashes,
    tenantHashes,
    fieldStatuses
  );

  // Per-field statuses surfaced on the result for JSON consumers / verbose
  // human output. Convert the opaque baselineLookupKey to a readable label.
  const perFieldList = [...fieldStatuses].map(([key, fieldStatus]) => ({
    key: humanizeFieldKey(key),
    status: fieldStatus,
  }));

  // Decide whether to write a recipe file for this handle, then resolve the
  // on-disk path. Per-field merge applies under `tenant-wins` for
  // content-bearing kinds when both sides exist; other kinds adopt the
  // tenant projection wholesale.
  const shouldWrite = shouldWriteRecipe({ appliedPlan, policy, status, diskRecipe, tenantRecipe });
  const filePath = await resolveRecipeFilePath({
    shouldWrite,
    appliedPlan,
    policy,
    handle,
    diskRecipe,
    tenantRecipe,
    fieldStatuses,
    winnerOverridesByHandle: args.winnerOverridesByHandle,
    tenantIrByHandle: args.tenantIrByHandle,
    diskIrByHandle: args.diskIrByHandle,
    dryRun,
    outputDir,
  });

  const kind = (tenantRecipe ?? diskRecipe)!.kind;
  const entry: RecipePullEntry = {
    handle,
    kind,
    path: filePath,
    status,
    diskChangedFields: diskChanged,
    tenantChangedFields: tenantChanged,
    ...(perFieldList.length > 0 && { fieldStatuses: perFieldList }),
  };

  // Apply-plan mode short-circuits the error gate — the operator already
  // reviewed + committed their picks by editing the plan; exit non-zero
  // would defeat the purpose of running --apply-plan.
  const blocked =
    appliedPlan === null &&
    policy === "error" &&
    (status === "tenant-edited" || status === "conflict");

  return {
    kind,
    entry,
    planSourceEntry: buildPlanSourceEntry({
      handle,
      kind,
      status,
      fieldStatuses,
      tenantIrByHandle: args.tenantIrByHandle,
      diskIrByHandle: args.diskIrByHandle,
    }),
    blocked,
  };
};

/** Human-readable merge-mode summary rendering (skipped in JSON mode). */
const renderMergeSummary = (args: {
  result: RecipePullResult;
  byStatus: Record<RecipeMergeStatus, number>;
  files: readonly RecipePullEntry[];
  blocked: boolean;
  envName: string;
  against: string;
  policy: string;
  outputDir: string;
  logger: ReturnType<typeof toLogger>;
}): void => {
  const { result, byStatus, files, blocked, envName, against, policy, outputDir, logger } = args;
  logger.info(
    `Pulled ${result.totalRecipes} recipes from ${envName} (merge against ${against}, policy=${policy})`,
    "cyan"
  );
  for (const [statusKey, count] of Object.entries(byStatus).sort()) {
    if (count === 0) continue;
    const color =
      statusKey === "conflict" || statusKey === "tenant-edited"
        ? "yellow"
        : statusKey === "disk-only"
          ? "yellow"
          : "green";
    logger.info(`  ${statusKey}: ${count}`, color);
  }
  for (const entry of files) {
    if (entry.status === "in-sync") continue;
    const tag =
      entry.status === "tenant-edited" || entry.status === "conflict"
        ? "!"
        : entry.status === "disk-ahead"
          ? "+"
          : "?";
    logger.info(
      `  [${tag}] ${entry.handle}  ${entry.status}` +
        (entry.diskChangedFields || entry.tenantChangedFields
          ? `  (disk:${entry.diskChangedFields}, tenant:${entry.tenantChangedFields})`
          : "") +
        (entry.path ? `  → ${path.relative(outputDir, entry.path)}` : "")
    );
  }
  if (blocked) {
    logger.info(
      `  ! blocked by --policy=error: ${byStatus["tenant-edited"]} tenant-edited + ${byStatus.conflict} conflict`,
      "yellow"
    );
  }
};

export const runRecipePull = async (options: RecipePullOptions): Promise<RecipePullResult> => {
  const logger = toLogger(options);
  const tenant = resolveTenant(options);
  const roots = resolveRoots(options, tenant.environment);

  const tenantRecipes = await readCurrentRecipes(roots, tenant.client);
  if (tenantRecipes === null) {
    throw createScaiError(
      `No recipe-projectable roots are configured for environment '${tenant.envName}'.`,
      "INPUT_INVALID",
      {
        hint: "Set at least one of templatesRoot, componentsRoot, contentModelsRoot, pageTemplatesRoot, enumerationsRoot, partialDesignsRoot, pageDesignsRoot, pagesRoot, placeholderSettingsRoot, or contentItemsRoot in the env profile, or pass the matching --*-root flag.",
      }
    );
  }

  const outputDir = path.resolve(options.output ?? "./pulled-recipes");
  const dryRun = Boolean(options.dryRun);
  // Dry-run skips every fs.writeFile / mkdir; classification + reads
  // still happen so the operator sees the full diff without touching
  // the FS.
  if (!dryRun) await fs.mkdir(outputDir, { recursive: true });

  const byStatus: Record<RecipeMergeStatus, number> = {
    "in-sync": 0,
    "disk-ahead": 0,
    "tenant-edited": 0,
    conflict: 0,
    "disk-only": 0,
    "tenant-only": 0,
  };

  // ───── Snapshot mode (no --against) ────────────────────────────────────
  if (options.against === undefined) {
    return runSnapshotMode({
      tenantRecipes,
      outputDir,
      dryRun,
      byStatus,
      envName: tenant.envName,
      logger,
    });
  }

  // ───── Merge mode (--against set) ──────────────────────────────────────
  // 1. Read disk recipes (sourced from --against or the config glob)
  // 2. Compile both sides to IRs through the same compile pipeline
  // 3. Hash each side via collectBaselineEntries
  // 4. Load baseline per recipe
  // 5. Classify per recipe + apply --policy (or --apply-plan winners)
  const policy = options.conflictPolicy ?? "error";

  // Load + validate the merge plan up front when --apply-plan is set.
  // The plan's environment must match the current run's env (a plan
  // generated against staging shouldn't accidentally apply to prod).
  // Per-(recipe, field) winner-override maps are built here; per-recipe
  // entries are looked up by handle in the loop below.
  const winnerOverridesByHandle = new Map<string, Map<string, "disk" | "tenant">>();
  const appliedPlan = await loadAppliedPlan(options, tenant.envName, winnerOverridesByHandle);

  // Reuse push's input resolution + roots resolution so the merge
  // semantics match what push would compile against. `resolveRecipeInputs`
  // honors the config glob when input isn't a single file.
  const { files: diskFiles } = await resolveRecipeInputs(
    { ...options, input: options.against },
    tenant.root
  );
  const diskFilesOnly = diskFiles.filter((f) => !f.endsWith(".ir.json"));
  const diskRecipes: Recipe[] = await mapWithConcurrency(diskFilesOnly, (f) => loadRecipe(f));

  const { templatesRoot, renderingsRoot } = resolveRecipeRoots(
    options,
    tenant.environment,
    tenant.envName,
    recipeSetNeedsRoots(diskRecipes) || recipeSetNeedsRoots(tenantRecipes)
  );
  const compileContext = {
    templatesRoot,
    renderingsRoot,
    componentsRoot: options.componentsRoot ?? tenant.environment.componentsRoot,
    contentModelsRoot: options.contentModelsRoot ?? tenant.environment.contentModelsRoot,
    partialDesignsRoot: options.partialDesignsRoot ?? tenant.environment.partialDesignsRoot,
    pageDesignsRoot: options.pageDesignsRoot ?? tenant.environment.pageDesignsRoot,
    contentItemsRoot: options.contentItemsRoot ?? tenant.environment.contentItemsRoot,
    headlessVariantsRoot: tenant.environment.headlessVariantsRoot,
    availableRenderingsRoot: tenant.environment.availableRenderingsRoot,
    enumerationsRoot: options.enumerationsRoot ?? tenant.environment.enumerationsRoot,
    pageTemplatesRoot: options.pageTemplatesRoot ?? tenant.environment.pageTemplatesRoot,
    placeholderSettingsRoot:
      options.placeholderSettingsRoot ?? tenant.environment.placeholderSettingsRoot,
    pagesRoot: options.pagesRoot ?? tenant.environment.pagesRoot,
    site: resolveSeedSite(tenant.environment),
  };
  const diskIrs = compileRecipeSet(diskRecipes, compileContext);
  const tenantIrs = compileRecipeSet(tenantRecipes, compileContext);

  // Hash maps keyed by recipe handle.
  const diskHashByHandle = new Map<string, Map<string, string>>();
  const diskIrByHandle = new Map<string, OperationIr>();
  for (const ir of diskIrs) {
    diskHashByHandle.set(ir.recipeHandle, indexHashes(collectBaselineEntries(ir, new Map())));
    diskIrByHandle.set(ir.recipeHandle, ir);
  }
  const tenantHashByHandle = new Map<string, Map<string, string>>();
  const tenantIrByHandle = new Map<string, OperationIr>();
  for (const ir of tenantIrs) {
    tenantHashByHandle.set(ir.recipeHandle, indexHashes(collectBaselineEntries(ir, new Map())));
    tenantIrByHandle.set(ir.recipeHandle, ir);
  }

  // Build a recipe-by-handle lookup for both sides so the per-recipe loop
  // can re-emit the right Recipe object based on the status. Both calls
  // detect same-side cross-kind collisions; assertCrossSideKinds adds the
  // cross-side check.
  const diskRecipeByHandle = buildRecipeByHandle("disk", diskRecipes);
  const tenantRecipeByHandle = buildRecipeByHandle("tenant", tenantRecipes);
  assertCrossSideKinds(diskRecipeByHandle, tenantRecipeByHandle);

  const configDir = path.dirname(tenant.root.physicalPath);
  const allHandles = new Set<string>([
    ...diskRecipeByHandle.keys(),
    ...tenantRecipeByHandle.keys(),
  ]);

  // Pluggable baseline storage. Defaults to file-backed under
  // <configDir>/.scai/baseline/. Operators can pass a custom impl
  // (orchestrator-hosted, in-memory) via RecipePullOptions.baselineStorage.
  const baselineStorage = options.baselineStorage ?? new FileBaselineStorage(configDir);

  // Parallel baseline preload: file storage is mostly disk-bound and
  // loads are independent per-recipe. Pre-fetching here lets the main
  // loop run with all baselines in hand — no sequential await inside
  // the loop. The Map is built once + read by reference.
  const baselineHashesByHandle = new Map<string, Map<string, string> | null>();
  if (!options.noBaseline) {
    const handlesNeedingBaseline = [...allHandles];
    const baselineEntries = await mapWithConcurrency(handlesNeedingBaseline, async (handle) => {
      const baseline = await baselineStorage.load(tenant.envName, handle);
      return [handle, baseline ? indexHashes(baseline.fields) : null] as const;
    });
    for (const [handle, hashes] of baselineEntries) baselineHashesByHandle.set(handle, hashes);
  }

  // Apply-plan: verify every plan-referenced recipe is in the current run.
  assertPlanRecipesPresent(appliedPlan, allHandles);

  const files: RecipePullEntry[] = [];
  const byKind: Record<string, number> = {};
  let blocked = false;
  // Per-recipe entries to compose into the merge-plan file (when
  // --write-plan is set). Collected during the per-handle loop and
  // emitted after, so the plan reflects the same classifications the
  // result entries do.
  //
  // For template-style recipes the statuses are pre-rolled (per-property
  // statuses collapsed to one entry per template field) so the plan +
  // mergeTemplateRecipe.winnerFor agree on the key shape. Labels are
  // also pre-computed so the plan shows "Title (param)" rather than the
  // unrecognisable bare fieldRefKey under humanizeFieldKey.
  const planSourceEntries: Array<{
    handle: string;
    kind: string;
    rollupStatus: RecipeMergeStatus;
    fieldStatuses: PerFieldStatuses;
    labels?: Map<string, string>;
  }> = [];
  for (const handle of allHandles) {
    const outcome = await classifyHandle({
      handle,
      diskRecipeByHandle,
      tenantRecipeByHandle,
      diskHashByHandle,
      tenantHashByHandle,
      baselineHashesByHandle,
      appliedPlan,
      policy,
      winnerOverridesByHandle,
      tenantIrByHandle,
      diskIrByHandle,
      dryRun,
      outputDir,
    });
    byKind[outcome.kind] = (byKind[outcome.kind] ?? 0) + 1;
    byStatus[outcome.entry.status] += 1;
    files.push(outcome.entry);
    planSourceEntries.push(outcome.planSourceEntry);
    if (outcome.blocked) blocked = true;
  }

  // Write the merge plan when --write-plan is set. Done after the loop
  // so the plan reflects the same per-recipe classifications + per-field
  // statuses the result entries do. Uses an opt-passed `now` for tests;
  // production stamps the current time.
  if (options.writePlan !== undefined && !dryRun) {
    const generatedAt = options.now ?? new Date().toISOString();
    const plan = composeMergePlan(tenant.envName, policy, generatedAt, planSourceEntries);
    const planPath = path.resolve(options.writePlan);
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await writeFileAtomic(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  }

  const result: RecipePullResult = {
    outputDir,
    totalRecipes: allHandles.size,
    byKind,
    byStatus,
    files,
    blocked,
  };

  if (logger.isJson()) {
    logger.json({
      command: "recipe.pull",
      environment: tenant.envName,
      mode: "merge",
      policy,
      ...result,
    });
    return result;
  }

  renderMergeSummary({
    result,
    byStatus,
    files,
    blocked,
    envName: tenant.envName,
    against: options.against,
    policy,
    outputDir,
    logger,
  });
  return result;
};
