import { randomUUID } from "node:crypto";
import path from "node:path";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import { getAccessToken } from "../api/auth";
import type { RemoteItem } from "../api/client";
import { createSitesApiClient, type SitesApiClient } from "../api/sites-client";
import {
  cachedSkipFor,
  hashIr,
  hashRoots,
  loadRecipeCache,
  recordCacheEntry,
  saveRecipeCache,
} from "../cache";
import { compileRecipeSet } from "../compile";
import { PAGE_DESIGNS_ROOT_REF_KEY, templatePathRefKey } from "../guids";
import { loadIr, loadRecipe } from "../io";
import { executeIr, type ExecutionEvent, type ExecutionResult } from "../execute";
import type { Operation, OperationIr } from "../ir/operations";
import { applyPlaceholderAllowControls, type PlaceholderAllowResult } from "./placeholder-allow";
import { createRollbackLogger } from "../rollback-log";
import type { Recipe } from "../schema/recipe";
import {
  ensureAllowWrite,
  resolveRecipeInputs,
  resolveRecipeRoots,
  resolveTenant,
  toLogger,
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
 * `scai recipe push` — apply recipes to a tenant.
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
    ensureAllowWrite(tenant.root, tenant.envName, options.allowWrite);
  }

  // One rollback-log scope per `recipe push` invocation. The file at
  // `~/.sitecoreai/rollback/<runId>.jsonl` is created lazily by the
  // logger on first write — successful pushes leave no file behind.
  const rollbackRunId = randomUUID();
  const rollbackLog = createRollbackLogger(rollbackRunId);

  const { templatesRoot, renderingsRoot } = resolveRecipeRoots(
    options,
    tenant.environment,
    tenant.envName
  );
  // Phase 2 per-site folder layout roots — optional at the envProfile
  // level. When unset the compiler falls back to `templatesRoot` for
  // both, which means section-aware components nest under templatesRoot
  // (mid-migration fallback) and content templates land mixed in with
  // components. The orchestrator's ephemeral CLI config sets both.
  const componentsRoot = options.componentsRoot ?? tenant.environment.componentsRoot;
  const contentModelsRoot = options.contentModelsRoot ?? tenant.environment.contentModelsRoot;
  // Phase 4 composition roots — optional at the envProfile level. The
  // per-recipe compile fns throw with their own clear messages if a
  // partial-design / page-design / content-item recipe is in the set
  // but the corresponding root is unset. CLI flag overrides match the
  // templatesRoot / renderingsRoot pattern.
  const partialDesignsRoot = options.partialDesignsRoot ?? tenant.environment.partialDesignsRoot;
  const pageDesignsRoot = options.pageDesignsRoot ?? tenant.environment.pageDesignsRoot;
  const contentItemsRoot = options.contentItemsRoot ?? tenant.environment.contentItemsRoot;
  // SXA Headless variants root — required when any recipe in the set
  // declares variants. Compiler throws INPUT_INVALID with a clear hint
  // if a recipe asks for variants but this root is unset; if no
  // recipe in the set has variants, this stays unset and the
  // compiler skips the check.
  const headlessVariantsRoot =
    options.headlessVariantsRoot ?? tenant.environment.headlessVariantsRoot;
  // SXA Available Renderings root — when set, compileRecipeSet emits
  // a synthetic IR with one Available Renderings section per
  // `recipe.section`, listing every rendering in that section.
  const availableRenderingsRoot =
    options.availableRenderingsRoot ?? tenant.environment.availableRenderingsRoot;
  // Per-site enumerations bucket — required for EnumerationRecipe
  // compilation and for any field carrying `sitecore.enumHandle`.
  const enumerationsRoot = options.enumerationsRoot ?? tenant.environment.enumerationsRoot;

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
  // Phase 4: recipe-source files compile through `compileRecipeSet` so
  // cross-recipe `TemplatesMapping` contributions (every PageDesignRecipe
  // contributes one entry per `appliesTo` template) aggregate into a
  // single synthetic IR. Pre-compiled `.ir.json` inputs load directly —
  // the aggregate-IR opportunity is gone for those, but the executor
  // still applies whatever's there.
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
  const recipes: Recipe[] = await mapWithConcurrency(recipeFiles, (f) => loadRecipe(f));
  const compiled: OperationIr[] = compileRecipeSet(recipes, {
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
  });
  const loadedIrs: OperationIr[] = await mapWithConcurrency(irFiles, (f) => loadIr(f));
  const irs: { ir: OperationIr }[] = [
    ...compiled.map((ir) => ({ ir })),
    ...loadedIrs.map((ir) => ({ ir })),
  ];

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
        `Failed to mint a Sites API access token for environment '${tenant.envName}'. Run 'scai login' or set client credentials, then retry.`,
        "AUTH_REQUIRED"
      );
    }
    sitesClient = createSitesApiClient({ accessToken });
  }

  // Recipe-source files (vs pre-compiled `.ir.json`) are kept in scope
  // for the post-IR placeholder-allow phase. Pre-compiled IRs lose
  // their source-recipe handle/section/name → can't drive placeholder
  // resolution; for those, callers should run `scai deploy placeholders`
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

  // Surface cache-skips as zero-effect ExecutionResults so downstream
  // callers (orchestrator, JSON consumers) see a uniform shape across
  // skipped + executed recipes.
  for (const { ir, entry } of cachedSkips) {
    const skipSummary = { create: 0, update: 0, skip: ir.operations.length, error: 0 };
    results.push({
      plan: {
        schemaVersion: "1",
        recipeHandle: ir.recipeHandle,
        actions: [],
        summary: skipSummary,
      },
      summary: skipSummary,
      aborted: false,
    });
    if (!logger.isJson()) {
      logger.info(
        `Skipping ${ir.recipeHandle} on ${tenant.envName} (unchanged since ${entry?.lastApplied ?? "previous push"})`,
        "green"
      );
    }
  }

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

  // ─── Plan or apply ────────────────────────────────────────────────────
  // Plan-mode reads are pure and have no cross-recipe ordering
  // requirements once `crossRecipeRefs` + the prefetch have populated
  // the workspace caches — so plan-mode IRs run concurrently. Apply
  // mode stays sequential per-IR; mutations within and across recipes
  // can have ordering dependencies that the topological IR encoding
  // already respects in a serial walk.
  const planConcurrency = options.planConcurrency ?? DEFAULT_PLAN_CONCURRENCY;
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
        result.summary.error ? ` / ${result.summary.error} error` : ""
      }`,
      result.summary.error || result.aborted ? "yellow" : "green"
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
    }
  }

  // ─── Persist hash cache ────────────────────────────────────────────────
  // Only after a successful (non-aborted, non-error) apply. Plan-mode
  // (dry-run) doesn't update the cache — it can't validate that the
  // tenant matches what the cache implies.
  if (!isDryRun && options.skipUnchangedRecipes && recipeCache) {
    for (const { ir, irHash } of irsToExecute) {
      const result = results.find((r) => r.plan.recipeHandle === ir.recipeHandle);
      if (!result || result.aborted || result.summary.error > 0) continue;
      recordCacheEntry(recipeCache, tenant.envName, rootsHash, ir.recipeHandle, {
        irHash,
        lastApplied: new Date().toISOString(),
        summary: {
          create: result.summary.create,
          update: result.summary.update,
          skip: result.summary.skip,
        },
      });
    }
    await saveRecipeCache(configDir, recipeCache);
  }

  // Post-IR phase: register each component-template recipe's
  // rendering with the placeholder slots it declares compatibility
  // with (`recipe.placedIn: string[]`). Runs only on apply mode
  // and only when at least one IR succeeded (a fully-aborted push
  // shouldn't dirty unrelated placeholders). Skipped when the env
  // profile doesn't configure `placeholderSettingsRoots` — empty list
  // means no slots to walk.
  const placeholderRoots = tenant.environment.placeholderSettingsRoots ?? [];
  const anyComponentRecipeDeclaresPlaceholders = sourceRecipes.some(
    (r) => r.kind === "component-template" && Array.isArray(r.placedIn) && r.placedIn.length > 0
  );
  let placeholderAllowSummary: PlaceholderAllowResult | null = null;
  if (
    !isDryRun &&
    anyComponentRecipeDeclaresPlaceholders &&
    placeholderRoots.length > 0 &&
    results.some((r) => !r.aborted)
  ) {
    placeholderAllowSummary = await applyPlaceholderAllowControls({
      client: tenant.client,
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
  }

  if (rollbackLog.wasUsed && !logger.isJson()) {
    logger.warn(`Rollback audit log written to ${rollbackLog.logPath}`);
  }

  if (logger.isJson()) {
    logger.json({
      command: "recipe.push",
      environment: tenant.envName,
      source,
      whatIf: isDryRun,
      placeholderAllowControls: placeholderAllowSummary ?? undefined,
      rollbackLog: rollbackLog.wasUsed
        ? { runId: rollbackLog.runId, path: rollbackLog.logPath }
        : undefined,
      results: results.map((r) => ({
        recipeHandle: r.plan.recipeHandle,
        summary: r.summary,
        aborted: r.aborted,
        rollback: r.rollback ?? null,
      })),
      events: allEvents.map(({ recipe, event }) => ({
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
      })),
    });
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
  }
};
