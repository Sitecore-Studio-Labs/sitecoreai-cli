import { randomUUID } from "node:crypto";
import path from "node:path";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createScaiError } from "@/shared/errors";
import type { EnvironmentConfiguration } from "@/config/types";
import { discoverSites } from "@/authoring";
import { getAccessToken } from "../api/auth";
import type { AuthoringApiClient, RemoteItem } from "../api/client";
import { createSitesApiClient, type SitesApiClient } from "../api/sites-client";
import {
  cachedSkipFor,
  hashIr,
  hashRoots,
  loadRecipeCache,
  recordCacheEntry,
  saveRecipeCache,
} from "../runtime/cache";
import { compileRecipeSet } from "../compile";
import { PAGE_DESIGNS_ROOT_REF_KEY, templatePathRefKey } from "../items/guids";
import { ensureMarkerField } from "../items/ensure-marker-field";
import { loadIr, loadRecipe } from "../io";
import {
  ensureEnvironmentLanguages,
  executeIr,
  type ExecutionEvent,
  type ExecutionResult,
} from "../runtime/execute";
import { writeProgressLine } from "./progress-stream";
import { type BaselineIndex, FileBaselineStorage, indexBaseline } from "../runtime/baseline";
import { collectBaselineEntries } from "../runtime/baseline-capture";
import type { Operation, OperationIr } from "../ir/operations";
import { applyPlaceholderAllowControls, type PlaceholderAllowResult } from "./placeholder-allow";
import { createRollbackLogger } from "../rollback/rollback-log";
import type { Recipe } from "../schema/recipe";
import {
  ensureAllowWrite,
  ensureSiteCollection,
  loadImageDefaults,
  recipeSetNeedsRoots,
  resolveRecipeInputs,
  resolveRecipeRoots,
  resolveSeedSite,
  resolveSitePathSegment,
  resolveTenant,
  toLogger,
  withDerivedRecipeRoots,
  type RecipePushOptions,
} from "./shared";

const DEFAULT_PLAN_CONCURRENCY = 4;

/**
 * Collect every Sitecore content-tree path the executor MIGHT need to
 * read up-front, given a set of compiled IRs and the cross-recipe ref
 * map. Used to fan a single batched `getItemsByPaths` call out before
 * the per-op plan loop runs.
 *
 * Sources:
 *   - Every CreateItem op's target path
 *   - Every CreateItem op's ref-path parent path (e.g. configured
 *     templatesRoot/renderingsRoot for top-level items)
 *   - Every cross-recipe ref's expectedPath
 *   - Every SetField/AppendToMultiList op's optional `latePath`
 *
 * De-duplicates within and across IRs — a single root path shared by
 * 5 components ends up as one prefetch entry, not 5.
 */
const collectPrefetchPaths = (
  irs: OperationIr[],
  crossRecipeRefs: ReadonlyMap<string, string>
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string | undefined): void => {
    if (!p) return;
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  for (const ir of irs) {
    for (const op of ir.operations as Operation[]) {
      if (op.op === "CreateItem") {
        add(op.path);
        if (op.parent.kind === "ref-path") add(op.parent.value);
      } else if (op.op === "SetField" || op.op === "AppendToMultiList") {
        add(op.latePath);
      }
    }
  }
  for (const expectedPath of crossRecipeRefs.values()) {
    add(expectedPath);
  }
  return out;
};

/**
 * Partition the resolved input file list into recipe-source files and
 * pre-compiled `.ir.json` files. Recipes compile through `compileRecipeSet`
 * (so cross-recipe aggregates form); IRs load directly.
 */
const partitionInputFiles = (
  files: readonly string[]
): { recipeFiles: string[]; irFiles: string[] } => {
  const recipeFiles: string[] = [];
  const irFiles: string[] = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".json" && file.endsWith(".ir.json")) {
      irFiles.push(file);
    } else {
      recipeFiles.push(file);
    }
  }
  return { recipeFiles, irFiles };
};

/**
 * Build the workspace-wide refKey → expectedPath map the executor uses to
 * seed `capturedItemIds` with cross-recipe references the current recipe's
 * own ops don't produce. Seeds every CreateItem op's id→path, every
 * `templateOf: ref-path`, and the synthetic Page Designs root.
 */
const buildCrossRecipeRefs = (
  irs: ReadonlyArray<{ ir: OperationIr }>,
  pageDesignsRoot: string | undefined
): Map<string, string> => {
  const crossRecipeRefs = new Map<string, string>();
  for (const { ir } of irs) {
    for (const op of ir.operations) {
      if (op.op === "CreateItem") {
        crossRecipeRefs.set(op.id, op.path);
        // templateOf: ref-path needs the same lookup-before-plan seed
        // path-parent resolution uses. Compute the deterministic
        // refKey + the target path; the executor's
        // `getItemsByPaths` batch picks it up alongside parent paths.
        if (typeof op.templateOf !== "string" && op.templateOf.kind === "ref-path") {
          crossRecipeRefs.set(templatePathRefKey(op.templateOf.value), op.templateOf.value);
        }
      }
    }
  }
  // Seed the synthetic Page Designs root refKey so the cross-recipe
  // `TemplatesMapping` aggregate op (emitted by `compileRecipeSet` when
  // any page design declares `appliesTo`) resolves its target. The
  // executor walks the path and stores the captured itemId in
  // `capturedItemIds` before applying the SetField op. Skip the seed
  // when `pageDesignsRoot` isn't set — without page designs in the
  // set, the aggregate IR isn't emitted and the seed wouldn't be used
  // anyway.
  if (pageDesignsRoot) {
    crossRecipeRefs.set(PAGE_DESIGNS_ROOT_REF_KEY, pageDesignsRoot);
  }
  return crossRecipeRefs;
};

/** Flatten one collected `{ recipe, event }` into the JSON output shape. */
const eventToJson = ({
  recipe,
  event,
}: {
  recipe: string;
  event: ExecutionEvent;
}): Record<string, unknown> => ({
  recipe,
  kind: event.kind,
  index: "index" in event ? event.index : "action" in event ? event.action.index : undefined,
  label:
    "operation" in event
      ? event.operation.label
      : "action" in event
        ? event.action.operation.label
        : undefined,
  status: "action" in event ? event.action.status : undefined,
  reason: "action" in event ? event.action.reason : undefined,
  diff: "action" in event ? event.action.diff : undefined,
  mutation: "action" in event ? event.action.mutation : undefined,
  error: "error" in event ? event.error : undefined,
});

/**
 * Resolve every per-site folder-layout root the compiler may need, applying
 * the CLI-flag-overrides-env-profile precedence uniformly. Roots the compiler
 * reads straight off the env profile (no CLI override) pass through verbatim.
 */
const resolveCompileRoots = (
  options: RecipePushOptions,
  envArg: EnvironmentConfiguration
): {
  componentsRoot: string | undefined;
  contentModelsRoot: string | undefined;
  partialDesignsRoot: string | undefined;
  pageDesignsRoot: string | undefined;
  contentItemsRoot: string | undefined;
  mediaLibraryRoot: string | undefined;
  headlessVariantsRoot: string | undefined;
  availableRenderingsRoot: string | undefined;
  enumerationsRoot: string | undefined;
  pageTemplatesRoot: string | undefined;
  placeholderSettingsRoot: string | undefined;
  pagesRoot: string | undefined;
} => {
  // Backfill the optional folder-layout roots from site+collection derivation
  // when configured, before applying CLI-flag overrides (flag > derived).
  const env = withDerivedRecipeRoots(envArg) ?? envArg;
  return {
    componentsRoot: options.componentsRoot ?? env.componentsRoot,
    contentModelsRoot: options.contentModelsRoot ?? env.contentModelsRoot,
    partialDesignsRoot: options.partialDesignsRoot ?? env.partialDesignsRoot,
    pageDesignsRoot: options.pageDesignsRoot ?? env.pageDesignsRoot,
    contentItemsRoot: options.contentItemsRoot ?? env.contentItemsRoot,
    mediaLibraryRoot: options.mediaLibraryRoot ?? env.mediaLibraryRoot,
    headlessVariantsRoot: options.headlessVariantsRoot ?? env.headlessVariantsRoot,
    availableRenderingsRoot: options.availableRenderingsRoot ?? env.availableRenderingsRoot,
    enumerationsRoot: options.enumerationsRoot ?? env.enumerationsRoot,
    pageTemplatesRoot: env.pageTemplatesRoot,
    placeholderSettingsRoot: env.placeholderSettingsRoot,
    pagesRoot: env.pagesRoot,
  };
};

/**
 * Resolve the target environment's languages (Sites API `listLanguages`)
 * so `compileDictionaryRecipe` can align a dictionary's translation
 * locales to the brand's languages — the same language source the
 * brand-kit Glossary reads.
 *
 * Only queried when the set actually carries a `dictionary` recipe (a
 * component/page-only push pays no token mint). Best-effort: an auth or
 * network failure returns `undefined`, so the compiler falls back to
 * emitting every authored translation rather than aborting the push.
 * Returns the union of each language's `iso` and `regionalIsoCode`
 * (e.g. `["en", "fr", "pt", "pt-BR"]`), which the compiler matches
 * case-insensitively against phrase-translation locales.
 */
/**
 * Register every language a `SiteRecipe` in the set declares (`language` +
 * `languages`) on the environment BEFORE compile.
 *
 * `SiteRecipe.languages` is documented as "recipe push adds missing ones",
 * but the only place scai provisioned them was the `createSite` mutation —
 * which never runs when the site already exists. Meanwhile the compiler
 * filters each recipe's authored `__Standard Values` locale-map defaults and
 * dictionary translations down to the environment's *registered* languages
 * (`resolveEnvironmentLanguages` → `listLanguages`, resolved just below).
 * The net effect: on a re-push of an existing site, a declared-but-unregistered
 * locale (e.g. `ar-SA`) was dropped from the emitted IR entirely — so the
 * localized Standard Values and dictionary phrases never installed, even
 * though the recipe authored them.
 *
 * Provisioning here, ahead of language resolution, closes that gap: the
 * subsequent `listLanguages` sees the freshly-added locales, so the compiler
 * emits their versions and the push installs them — no site (re)creation
 * required. Idempotent (addLanguage 409s are treated as success) and
 * best-effort: an auth/network failure is swallowed so the push still
 * proceeds with whatever is already registered, matching the pre-existing
 * `resolveEnvironmentLanguages` failure stance.
 */
const ensureSiteRecipeLanguages = async (
  recipes: readonly Recipe[],
  environment: EnvironmentConfiguration
): Promise<void> => {
  const codes = new Set<string>();
  for (const recipe of recipes) {
    if (recipe.kind !== "site") continue;
    if (recipe.language) codes.add(recipe.language);
    for (const code of recipe.languages ?? []) codes.add(code);
  }
  if (codes.size === 0) return;
  const accessToken = await getAccessToken(environment);
  if (!accessToken) return;
  try {
    await ensureEnvironmentLanguages(createSitesApiClient({ accessToken }), [...codes]);
  } catch {
    // Non-fatal — see resolveEnvironmentLanguages. The push proceeds; a
    // locale that couldn't be registered is simply filtered out downstream.
  }
};

const resolveEnvironmentLanguages = async (
  recipes: readonly Recipe[],
  environment: EnvironmentConfiguration
): Promise<string[] | undefined> => {
  if (!recipes.some((r) => r.kind === "dictionary")) return undefined;
  const accessToken = await getAccessToken(environment);
  if (!accessToken) return undefined;
  try {
    const languages = await createSitesApiClient({ accessToken }).listLanguages();
    const codes = new Set<string>();
    for (const lang of languages) {
      if (lang.iso) codes.add(lang.iso);
      if (lang.regionalIsoCode) codes.add(lang.regionalIsoCode);
    }
    return codes.size > 0 ? [...codes] : undefined;
  } catch {
    // Non-fatal: without the list the compiler emits all authored
    // translations (pre-alignment behaviour). The push proceeds.
    return undefined;
  }
};

/**
 * Surface cache-skips as zero-effect ExecutionResults so downstream callers
 * (orchestrator, JSON consumers) see a uniform shape across skipped +
 * executed recipes. Pushes one result per skipped IR and logs the skip in
 * human mode.
 */
const emitCachedSkipResults = (
  cachedSkips: ReadonlyArray<{ ir: OperationIr; entry: ReturnType<typeof cachedSkipFor> }>,
  results: ExecutionResult[],
  envName: string,
  logger: ReturnType<typeof toLogger>
): void => {
  for (const { ir, entry } of cachedSkips) {
    const skipSummary = {
      create: 0,
      update: 0,
      skip: ir.operations.length,
      error: 0,
      prune: 0,
      conflict: 0,
    };
    results.push({
      plan: {
        schemaVersion: "1",
        recipeHandle: ir.recipeHandle,
        actions: [],
        summary: skipSummary,
      },
      summary: skipSummary,
      aborted: false,
      // Cached-skip path didn't run the executor — no refKeys to capture.
      capturedItemIds: new Map(),
    });
    if (!logger.isJson()) {
      logger.info(
        `Skipping ${ir.recipeHandle} on ${envName} (unchanged since ${entry?.lastApplied ?? "previous push"})`,
        "green"
      );
    }
  }
};

/**
 * Persist the recipe-hash skip cache after a successful apply. Only records
 * entries for recipes that applied cleanly (non-aborted, no errors). No-op in
 * dry-run, when `--skip-unchanged-recipes` is off, or with no loaded cache.
 */
const persistRecipeCache = async (args: {
  isDryRun: boolean;
  skipUnchangedRecipes: boolean | undefined;
  recipeCache: Awaited<ReturnType<typeof loadRecipeCache>> | null;
  irsToExecute: ReadonlyArray<{ ir: OperationIr; irHash: string }>;
  results: readonly ExecutionResult[];
  envName: string;
  rootsHash: string;
  configDir: string;
}): Promise<void> => {
  const { isDryRun, skipUnchangedRecipes, recipeCache, irsToExecute, results, envName, rootsHash } =
    args;
  if (isDryRun || !skipUnchangedRecipes || !recipeCache) return;
  for (const { ir, irHash } of irsToExecute) {
    const result = results.find((r) => r.plan.recipeHandle === ir.recipeHandle);
    if (!result || result.aborted || result.summary.error > 0) continue;
    recordCacheEntry(recipeCache, envName, rootsHash, ir.recipeHandle, {
      irHash,
      lastApplied: new Date().toISOString(),
      summary: {
        create: result.summary.create,
        update: result.summary.update,
        skip: result.summary.skip,
      },
    });
  }
  await saveRecipeCache(args.configDir, recipeCache);
};

/**
 * Persist the three-way-merge baseline after a successful apply. Writes one
 * per-field hash snapshot per recipe that applied cleanly (non-aborted,
 * no errors, no conflicts). No-op in dry-run or with `--no-baseline`.
 */
const persistBaselines = async (args: {
  isDryRun: boolean;
  noBaseline: boolean | undefined;
  irsToExecute: ReadonlyArray<{ ir: OperationIr }>;
  results: readonly ExecutionResult[];
  envName: string;
  baselineStorage: FileBaselineStorage | NonNullable<RecipePushOptions["baselineStorage"]>;
}): Promise<void> => {
  const { isDryRun, noBaseline, irsToExecute, results, envName, baselineStorage } = args;
  if (isDryRun || noBaseline) return;
  const capturedAt = new Date().toISOString();
  for (const { ir } of irsToExecute) {
    const result = results.find((r) => r.plan.recipeHandle === ir.recipeHandle);
    if (!result || result.aborted || result.summary.error > 0 || result.summary.conflict > 0) {
      continue;
    }
    const entries = collectBaselineEntries(ir, result.capturedItemIds);
    if (entries.length === 0) continue;
    await baselineStorage.write(envName, ir.recipeHandle, {
      schemaVersion: "1",
      recipeHandle: ir.recipeHandle,
      envName,
      capturedAt,
      fields: entries,
    });
  }
};

/**
 * Post-IR phase: register each component-template recipe's rendering with the
 * placeholder slots it declares compatibility with (`recipe.placedIn`). Runs
 * only on apply mode and only when at least one IR succeeded. Returns the
 * patch summary, or `null` when the phase didn't run.
 */
const runPlaceholderAllowPhase = async (args: {
  isDryRun: boolean;
  sourceRecipes: readonly Recipe[];
  placeholderRoots: readonly string[];
  results: readonly ExecutionResult[];
  client: AuthoringApiClient;
  renderingsRoot: string;
  logger: ReturnType<typeof toLogger>;
}): Promise<PlaceholderAllowResult | null> => {
  const { isDryRun, sourceRecipes, placeholderRoots, results, client, renderingsRoot, logger } =
    args;
  const anyComponentRecipeDeclaresPlaceholders = sourceRecipes.some(
    (r) => r.kind === "component-template" && Array.isArray(r.placedIn) && r.placedIn.length > 0
  );
  if (
    isDryRun ||
    !anyComponentRecipeDeclaresPlaceholders ||
    placeholderRoots.length === 0 ||
    !results.some((r) => !r.aborted)
  ) {
    return null;
  }
  const placeholderAllowSummary = await applyPlaceholderAllowControls({
    client,
    recipes: sourceRecipes,
    renderingsRoot,
    placeholderSettingsRoots: placeholderRoots,
    apply: true,
    onUpdate: (placeholderPath, added) => {
      if (!logger.isJson()) {
        logger.info(`  Placeholder ${placeholderPath} ← +${added} rendering(s)`, "cyan");
      }
    },
  });
  if (!logger.isJson()) {
    logger.info(
      `Placeholder allow-controls: ${placeholderAllowSummary.patched} placeholder(s) patched, ${placeholderAllowSummary.totalAdded} entry(ies) added`,
      placeholderAllowSummary.unmatchedPlaceholderKeys.length > 0 ? "yellow" : "green"
    );
    if (placeholderAllowSummary.unmatchedPlaceholderKeys.length > 0) {
      logger.warn(
        `  Unmatched placeholder keys (no Placeholder Settings item with that key under any configured root): ${placeholderAllowSummary.unmatchedPlaceholderKeys.join(", ")}`
      );
    }
    if (placeholderAllowSummary.unresolvedRecipeHandles.length > 0) {
      logger.warn(
        `  Recipes whose rendering item couldn't be resolved (skipped from placeholder registration): ${placeholderAllowSummary.unresolvedRecipeHandles.join(", ")}`
      );
    }
  }
  return placeholderAllowSummary;
};

/**
 * `scai provision recipe push` — apply recipes to a tenant.
 *
 * Input resolution:
 *   - `--input <file>` — single recipe (`.recipe.ts/.recipe.json`) or IR
 *     (`.ir.json`). The file extension picks the path: recipes are
 *     compiled in-memory, IRs are loaded directly.
 *   - default: expand the config `recipes` glob and push each match in
 *     turn (one IR per recipe; per-recipe events).
 *
 * Honors `--what-if` (becomes plan-only) and `--allow-write` (the
 * scai-wide safety gate). Streams progress as `task-progress`-style
 * events in JSON mode; renders a per-op summary in human mode.
 */
/**
 * Ensure the `Scai Handle` marker field exists on the Standard Template
 * before an apply push. Recipe identity (rename/move-robust matching +
 * exact handle recovery) hangs off it; `injectHandleMarker` stamps the
 * value on every CreateItem, but without the field the Authoring API
 * drops it and matching silently falls back to path/name.
 *
 * Idempotent (no-op when present), skipped under dry-run (no writes), and
 * best-effort: a bootstrap hiccup degrades to path/name matching this push
 * rather than aborting it.
 */
const bootstrapMarkerField = async (
  client: AuthoringApiClient,
  isDryRun: boolean,
  logger: ReturnType<typeof toLogger>
): Promise<void> => {
  if (isDryRun) return;
  try {
    const marker = await ensureMarkerField(client);
    if (marker.status === "created" && !logger.isJson()) {
      logger.info(
        "Bootstrapped the `Scai Handle` marker field on the Standard Template (recipe identity).",
        "cyan"
      );
    }
  } catch (error) {
    logger.warn(
      `Could not bootstrap the \`Scai Handle\` marker field — recipe identity falls back to path/name matching this push: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

/**
 * Apply-time updateItem concurrency (see `ExecuteOptions.applyConcurrency`).
 * Default 4 keeps push wall-clock down on large sets;
 * `SITECOREAI_APPLY_CONCURRENCY=1` restores the historical strictly-serial
 * apply.
 */
const resolveApplyConcurrency = (): number => {
  const raw = Number.parseInt(process.env.SITECOREAI_APPLY_CONCURRENCY ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
};

export const runRecipePush = async (options: RecipePushOptions): Promise<ExecutionResult[]> => {
  const logger = toLogger(options);
  // Workspace-wide path → itemId cache. Shared between the AuthoringApiClient
  // (for `ensurePathExists` fast-path) and the executor (for ref-path
  // parent resolution and cross-recipe refs). Lifetime = one push.
  const pathItemIdCache = new Map<string, string>();
  // Workspace-wide path → RemoteItem snapshot cache. Pre-populated by the
  // bulk prefetch (single batched `getItemsByPaths` call across every
  // CreateItem path); consulted by `buildAction` for plan-time reads.
  const pathSnapshotCache = new Map<string, RemoteItem | null>();

  const tenant = resolveTenant(options, { pathItemIdCache });

  const isDryRun = Boolean(options.whatIf);
  if (!isDryRun) {
    ensureAllowWrite(tenant.root, tenant.envName, options.allowWrite, "recipe-push");
  }

  // One rollback-log scope per `recipe push` invocation. The file at
  // `~/.sitecoreai/rollback/<runId>.jsonl` is created lazily by the
  // logger on first write — successful pushes leave no file behind.
  const rollbackRunId = randomUUID();
  const rollbackLog = createRollbackLogger(rollbackRunId);

  // When the env profile sets `site` but not `siteCollection`, discover the
  // collection (parent tenant) from the environment so recipeRoots derivation
  // has both values. No-op for explicit-roots / collection-set configs.
  const environment =
    (await ensureSiteCollection(tenant.environment, tenant.envName, (env) => discoverSites(env))) ??
    tenant.environment;

  // Per-site folder layout roots — optional at the envProfile level, with
  // CLI flags overriding the env profile. When unset the compiler falls back
  // to `templatesRoot` (section-aware components nest under templatesRoot in
  // the mid-migration fallback; content templates land mixed in with
  // components). The orchestrator's ephemeral CLI config sets these. The
  // per-recipe compile fns throw clear messages when a composition root is
  // unset but the matching recipe kind is present; `headlessVariantsRoot` /
  // `enumerationsRoot` are checked only when a recipe needs them.
  const {
    componentsRoot,
    contentModelsRoot,
    partialDesignsRoot,
    pageDesignsRoot,
    contentItemsRoot,
    mediaLibraryRoot,
    headlessVariantsRoot,
    availableRenderingsRoot,
    enumerationsRoot,
    pageTemplatesRoot,
    placeholderSettingsRoot,
    pagesRoot,
  } = resolveCompileRoots(options, environment);

  const { files, source } = await resolveRecipeInputs(options, tenant.root);
  const results: ExecutionResult[] = [];
  const allEvents: Array<{ recipe: string; event: ExecutionEvent }> = [];

  // Pre-compile every recipe so we can build a workspace-wide
  // refKey → expectedPath map. The executor uses this to seed
  // capturedItemIds with cross-recipe references the current recipe's
  // own ops don't produce (e.g. accordion-block's
  // `insertOptions: ["accordion-item@1"]` references accordion-item's
  // template, which lives in a different recipe's IR).
  //
  // Recipe-source files compile through `compileRecipeSet` so
  // cross-recipe `TemplatesMapping` contributions (every PageDesignRecipe
  // contributes one entry per `appliesTo` template) aggregate into a
  // single synthetic IR. Pre-compiled `.ir.json` inputs load directly —
  // the aggregate-IR opportunity is gone for those, but the executor
  // still applies whatever's there.
  const { recipeFiles, irFiles } = partitionInputFiles(files);
  const recipes: Recipe[] = await mapWithConcurrency(recipeFiles, (f) => loadRecipe(f));
  // Resolve templatesRoot / renderingsRoot now that the recipe kinds are
  // known: a set built only from workflow / webhook-authorization recipes
  // — which create items under hardcoded /sitecore/system roots — needs
  // neither. An IR-only push has an empty `recipes` and skips the
  // requirement too; pre-compiled IRs carry their roots baked in.
  const { templatesRoot, renderingsRoot } = resolveRecipeRoots(
    options,
    environment,
    tenant.envName,
    recipeSetNeedsRoots(recipes)
  );
  const imageDefaults = await loadImageDefaults(options.imageDefaults);
  // Provision any SiteRecipe-declared languages on the environment BEFORE
  // resolving the registered-language list, so a re-push of an existing site
  // installs its localized Standard Values / dictionary phrases (which the
  // compiler filters to registered languages) instead of dropping them.
  await ensureSiteRecipeLanguages(recipes, tenant.environment);
  const availableLanguages = await resolveEnvironmentLanguages(recipes, tenant.environment);
  const compiled: OperationIr[] = compileRecipeSet(recipes, {
    templatesRoot,
    renderingsRoot,
    componentsRoot,
    contentModelsRoot,
    partialDesignsRoot,
    pageDesignsRoot,
    contentItemsRoot,
    mediaLibraryRoot,
    imageDefaults,
    availableLanguages,
    headlessVariantsRoot,
    availableRenderingsRoot,
    enumerationsRoot,
    pageTemplatesRoot,
    placeholderSettingsRoot,
    pagesRoot,
    site: resolveSeedSite(environment),
    sitePathSegment: resolveSitePathSegment(environment),
    marketplacePluginOverrides: tenant.root.marketplacePluginOverrides,
  });
  const loadedIrs: OperationIr[] = await mapWithConcurrency(irFiles, (f) => loadIr(f));
  let irs: { ir: OperationIr }[] = [
    ...compiled.map((ir) => ({ ir })),
    ...loadedIrs.map((ir) => ({ ir })),
  ];

  // Optional `--handles` filter — narrow the IR set to the operator-
  // named handles after compile. Cross-recipe references already
  // resolved against the full set, so dropping unmatched IRs here is
  // safe. Unknown handles are diagnostic only; an all-unknown filter
  // yields an empty push (no-op).
  if (options.handles && options.handles.length > 0) {
    const requested = new Set(options.handles);
    const handlesInSet = new Set(irs.map(({ ir }) => ir.recipeHandle));
    const unknown = [...requested].filter((h) => !handlesInSet.has(h));
    if (unknown.length > 0) {
      logger.info(
        `--handles: ignoring unknown handle(s): ${unknown.join(", ")} (not present in compiled recipe set).`
      );
    }
    irs = irs.filter(({ ir }) => requested.has(ir.recipeHandle));
    logger.info(
      `--handles: pushing ${irs.length} of ${compiled.length + loadedIrs.length} recipe(s) (filtered to ${[...requested].filter((h) => handlesInSet.has(h)).join(", ") || "none"}).`
    );
  }

  const crossRecipeRefs = buildCrossRecipeRefs(irs, pageDesignsRoot);

  // Lazy-build a SitesApiClient only when an IR in the set needs one
  // (i.e. carries a CreateSiteFromTemplate op). Component / partial /
  // page-design / content-item recipes never reach Sites API — keep
  // their push paths free of unnecessary token mints.
  let sitesClient: SitesApiClient | undefined;
  const hasSiteOp = irs.some(({ ir }) =>
    ir.operations.some((op) => op.op === "CreateSiteFromTemplate")
  );
  if (hasSiteOp) {
    const accessToken = await getAccessToken(tenant.environment);
    if (!accessToken) {
      throw createScaiError(
        `Failed to mint a Sites API access token for environment '${tenant.envName}'. Run 'scai setup login' or set client credentials, then retry.`,
        "AUTH_REQUIRED"
      );
    }
    sitesClient = createSitesApiClient({ accessToken });
  }

  // Recipe-source files (vs pre-compiled `.ir.json`) are kept in scope
  // for the post-IR placeholder-allow phase. Pre-compiled IRs lose
  // their source-recipe handle/section/name → can't drive placeholder
  // resolution; for those, callers should run `scai provision deploy placeholders`
  // separately if needed.
  const sourceRecipes = recipes;

  // ─── Optional recipe-hash skip ────────────────────────────────────────
  // When `--skip-unchanged-recipes` is on, compare each compiled IR's
  // digest against the persisted cache. Cache hits short-circuit the
  // recipe entirely (zero plan-time reads, zero mutations); cache
  // misses fall through to the normal execute path.
  const configDir = path.dirname(tenant.root.physicalPath);
  const recipeCache = options.skipUnchangedRecipes ? await loadRecipeCache(configDir) : null;
  const rootsHash = hashRoots({
    templatesRoot,
    renderingsRoot,
    componentsRoot,
    contentModelsRoot,
    partialDesignsRoot,
    pageDesignsRoot,
    contentItemsRoot,
    headlessVariantsRoot,
    availableRenderingsRoot,
    enumerationsRoot,
    pageTemplatesRoot,
    placeholderSettingsRoot,
    pagesRoot,
    // GUID seed is part of the cache identity — toggling site scoping
    // changes every item's GUID, so a "default"-seeded cache entry must
    // not be reused once the profile opts in.
    seedSite: resolveSeedSite(environment),
  });
  const irsToExecute: { ir: OperationIr; irHash: string; cached: false }[] = [];
  const cachedSkips: {
    ir: OperationIr;
    irHash: string;
    entry: ReturnType<typeof cachedSkipFor>;
  }[] = [];

  for (const { ir } of irs) {
    const irHash = hashIr(ir);
    const cached =
      recipeCache && cachedSkipFor(recipeCache, tenant.envName, rootsHash, ir.recipeHandle, irHash);
    if (cached) {
      cachedSkips.push({ ir, irHash, entry: cached });
      continue;
    }
    irsToExecute.push({ ir, irHash, cached: false });
  }

  emitCachedSkipResults(cachedSkips, results, tenant.envName, logger);

  // ─── Workspace prefetch ────────────────────────────────────────────────
  // One batched `getItemsByPaths` call covering every path the executor
  // would otherwise read sequentially. On a re-push of an existing
  // recipe set this collapses N×ops sequential reads into ~ceil(N/25)
  // parallel batches, then the per-op plan loop hits the cache for
  // every read. On a first push, missing paths are cached as `null`
  // — buildAction sees that as "checked, missing → CreateItem applies".
  const prefetchPaths = collectPrefetchPaths(
    irsToExecute.map((e) => e.ir),
    crossRecipeRefs
  );
  if (prefetchPaths.length > 0) {
    const fetched = await tenant.client.getItemsByPaths(prefetchPaths);
    for (const [p, item] of fetched) {
      pathSnapshotCache.set(p, item);
      if (item) pathItemIdCache.set(p, item.itemId);
    }
  }

  // ─── Baseline load (three-way merge) ───────────────────────────────────
  // For each IR we're about to execute, load the persisted baseline file
  // (last-applied per-field hashes) so the planner can classify drift as
  // cms-edit / conflict vs plain recipe-change. Absent file → null index
  // (legacy two-way diff behaviour). The `--no-baseline` flag skips both
  // the load and the post-apply write.
  const baselineStorage = options.baselineStorage ?? new FileBaselineStorage(configDir);
  const baselineIndexByHandle = new Map<string, BaselineIndex>();
  if (!options.noBaseline) {
    // Parallel baseline reads: file storage is mostly disk-bound and
    // the loads are independent per-recipe. A 50-recipe push that was
    // sequential `await loadBaseline` now hits the disk concurrently.
    const entries = await mapWithConcurrency(irsToExecute, async ({ ir }) => {
      const baseline = await baselineStorage.load(tenant.envName, ir.recipeHandle);
      return [ir.recipeHandle, indexBaseline(baseline)] as const;
    });
    for (const [handle, index] of entries) baselineIndexByHandle.set(handle, index);
  }

  // Recipe identity hangs off the `Scai Handle` field on the Standard
  // Template — ensure it exists before applying. Idempotent + best-effort;
  // see `bootstrapMarkerField`.
  await bootstrapMarkerField(tenant.client, isDryRun, logger);

  // ─── Plan or apply ────────────────────────────────────────────────────
  // Plan-mode reads are pure and have no cross-recipe ordering
  // requirements once `crossRecipeRefs` + the prefetch have populated
  // the workspace caches — so plan-mode IRs run concurrently. Apply
  // mode stays sequential per-IR; mutations within and across recipes
  // can have ordering dependencies that the topological IR encoding
  // already respects in a serial walk.
  const planConcurrency = options.planConcurrency ?? DEFAULT_PLAN_CONCURRENCY;
  // ONE set across every IR in this push: update-ops in later IRs must
  // see creations from earlier IRs so baseline classification is
  // bypassed for items that didn't exist before this run.
  const createdItemRefKeys = new Set<string>();
  const runOne = async (ir: OperationIr): Promise<ExecutionResult> =>
    executeIr(ir, tenant.client, {
      mode: isDryRun ? "plan" : "apply",
      emit: (event) => {
        allEvents.push({ recipe: ir.recipeHandle, event });
        options.emit?.({ recipe: ir.recipeHandle, event });
      },
      signal: options.signal,
      crossRecipeRefs,
      sitesClient,
      pathItemIdCache,
      pathSnapshotCache,
      // Dry-run never rolls back, so the logger is a no-op there. Pass
      // it through anyway — the conditional lives inside the executor.
      rollbackLog,
      // Operator's prune consent (independent of `--apply`/--allow-write).
      // Undefined under dry-run is fine — the executor only checks it in
      // apply mode, and dry-run never reaches the delete-mode prune
      // dispatch path.
      allowPrune: options.allowPrune,
      // Languages to capture per-(language, version) field snapshots
      // for the prune rollback path. Defaults inside the planner to
      // ["en"] when undefined here.
      snapshotLanguages: options.snapshotLanguages,
      // Three-way merge baseline — set when --no-baseline is OFF and a
      // baseline file existed for this recipe. Maps every drifted field
      // to a `recipe-change` / `cms-edit` / `conflict` classification
      // the planner routes per `conflictPolicy`.
      baselineIndex: baselineIndexByHandle.get(ir.recipeHandle),
      conflictPolicy: options.conflictPolicy,
      createdItemRefKeys,
      applyConcurrency: resolveApplyConcurrency(),
    });

  const renderResult = (ir: OperationIr, result: ExecutionResult): void => {
    if (logger.isJson()) return;
    logger.info(
      `${isDryRun ? "Dry-run" : "Applying"} ${ir.recipeHandle} on ${tenant.envName}`,
      "cyan"
    );
    for (const action of result.plan.actions) {
      logger.info(
        `  ${formatActionTag(action.status)} ${action.operation.label}${
          action.reason ? ` — ${action.reason}` : ""
        }`
      );
      // Per-action prune list: operator sees every item that would (or
      // did) get removed, by path + template GUID. Indented under the
      // op so it stays readable in dense outputs.
      if (action.prunedItems && action.prunedItems.length > 0) {
        for (const pruned of action.prunedItems) {
          logger.info(`      - ${pruned.path}  (template ${pruned.templateId})`, "yellow");
        }
      }
      // Per-action multi-list replace summary: added/removed sets so the
      // operator sees exactly what changes vs the live list. Skipped when
      // both sides are empty (the planner emits skip status in that case).
      if (action.replacedListValues) {
        const { added, removed } = action.replacedListValues;
        for (const guid of added) logger.info(`      + ${guid}`, "green");
        for (const guid of removed) logger.info(`      - ${guid}`, "yellow");
      }
    }
    if (result.aborted && result.rollback) {
      logger.warn(
        `  Push aborted at op ${
          result.plan.actions[result.plan.actions.length - 1]?.index ?? "?"
        }; rolled back ${result.rollback.rolledBack} of ${result.plan.actions.filter((a) => a.mutation).length} applied.`
      );
      for (const err of result.rollback.errors) {
        logger.warn(`  ! rollback failed at ${err.label}: ${err.error}`);
      }
    }
    logger.info(
      `  Summary: ${result.summary.create} create / ${result.summary.update} update / ${result.summary.skip} skip${
        result.summary.prune ? ` / ${result.summary.prune} prune` : ""
      }${result.summary.error ? ` / ${result.summary.error} error` : ""}`,
      result.summary.error || result.aborted ? "yellow" : result.summary.prune ? "yellow" : "green"
    );
  };

  if (isDryRun) {
    const planResults = await mapWithConcurrency(
      irsToExecute,
      ({ ir }) => runOne(ir),
      planConcurrency
    );
    for (let i = 0; i < irsToExecute.length; i += 1) {
      const { ir } = irsToExecute[i];
      const result = planResults[i];
      results.push(result);
      renderResult(ir, result);
    }
  } else {
    for (const { ir } of irsToExecute) {
      const result = await runOne(ir);
      results.push(result);
      renderResult(ir, result);
      // Opt-in machine-readable per-recipe progress on stderr for
      // orchestrators driving the push with `--json` (which silences
      // renderResult). See progress-stream.ts.
      writeProgressLine({
        recipeHandle: ir.recipeHandle,
        index: results.length,
        total: irsToExecute.length,
        result,
      });
    }
  }

  // ─── Persist hash cache ────────────────────────────────────────────────
  // Only after a successful (non-aborted, non-error) apply. Plan-mode
  // (dry-run) doesn't update the cache — it can't validate that the
  // tenant matches what the cache implies.
  await persistRecipeCache({
    isDryRun,
    skipUnchangedRecipes: options.skipUnchangedRecipes,
    recipeCache,
    irsToExecute,
    results,
    envName: tenant.envName,
    rootsHash,
    configDir,
  });

  // ─── Persist three-way merge baseline ──────────────────────────────────
  // For each successfully-applied (non-aborted, non-error, non-conflict)
  // recipe, write the per-field hash snapshot to the baseline file. The
  // NEXT push's planner will load this and classify drift against it.
  // Dry-run doesn't write baseline — apply has to actually land for the
  // snapshot to reflect tenant truth. Conflict-status results are also
  // skipped: the recipe didn't fully apply, so capturing its desired
  // state as baseline would mask the unresolved conflict.
  await persistBaselines({
    isDryRun,
    noBaseline: options.noBaseline,
    irsToExecute,
    results,
    envName: tenant.envName,
    baselineStorage,
  });

  const placeholderRoots = tenant.environment.placeholderSettingsRoots ?? [];
  const placeholderAllowSummary = await runPlaceholderAllowPhase({
    isDryRun,
    sourceRecipes,
    placeholderRoots,
    results,
    client: tenant.client,
    renderingsRoot,
    logger,
  });

  if (rollbackLog.wasUsed && !logger.isJson()) {
    logger.warn(`Rollback audit log written to ${rollbackLog.logPath}`);
  }

  if (logger.isJson()) {
    const data = {
      results: results.map((r) => ({
        recipeHandle: r.plan.recipeHandle,
        summary: r.summary,
        aborted: r.aborted,
        rollback: r.rollback ?? null,
      })),
      events: allEvents.map(eventToJson),
    };
    logger.json(
      buildScaiEnvelope({
        command: "recipe.push",
        environment: tenant.envName,
        data,
        extra: {
          source,
          ...(isDryRun ? { whatIf: true as const } : {}),
          ...(placeholderAllowSummary ? { placeholderAllowControls: placeholderAllowSummary } : {}),
          ...(rollbackLog.wasUsed
            ? { rollbackLog: { runId: rollbackLog.runId, path: rollbackLog.logPath } }
            : {}),
        },
      }) as unknown as Record<string, unknown>
    );
  }

  return results;
};

const formatActionTag = (status: ExecutionResult["plan"]["actions"][number]["status"]): string => {
  switch (status) {
    case "create":
      return "[+]";
    case "update":
      return "[~]";
    case "skip":
      return "[ ]";
    case "error":
      return "[!]";
    case "prune":
      return "[-]";
    case "conflict":
      return "[?]";
  }
};
