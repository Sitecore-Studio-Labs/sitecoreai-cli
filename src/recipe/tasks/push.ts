import path from "node:path";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createCliError } from "@/shared/errors";
import { getAccessToken } from "../api/auth";
import { createSitesApiClient, type SitesApiClient } from "../api/sites-client";
import { compileRecipeSet } from "../compile";
import { PAGE_DESIGNS_ROOT_REF_KEY } from "../guids";
import { loadIr, loadRecipe } from "../io";
import { executeIr, type ExecutionEvent, type ExecutionResult } from "../execute";
import type { OperationIr } from "../ir/operations";
import { applyPlaceholderAllowControls, type PlaceholderAllowResult } from "./placeholder-allow";
import type { Recipe } from "../schema/recipe";
import {
  ensureAllowWrite,
  resolveRecipeInputs,
  resolveRecipeRoots,
  resolveTenant,
  toLogger,
  type RecipePushOptions,
} from "./shared";

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
  const tenant = resolveTenant(options);

  const isDryRun = Boolean(options.whatIf);
  if (!isDryRun) {
    ensureAllowWrite(tenant.root, tenant.envName, options.allowWrite);
  }

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
      if (op.op === "CreateItem") crossRecipeRefs.set(op.id, op.path);
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
      throw createCliError(
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

  for (const { ir } of irs) {
    const result = await executeIr(ir, tenant.client, {
      mode: isDryRun ? "plan" : "apply",
      emit: (event) => allEvents.push({ recipe: ir.recipeHandle, event }),
      crossRecipeRefs,
      sitesClient,
    });
    results.push(result);

    if (!logger.isJson()) {
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
    }
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
    (r) =>
      r.kind === "component-template" && Array.isArray(r.placedIn) && r.placedIn.length > 0
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

  if (logger.isJson()) {
    logger.json({
      command: "recipe.push",
      environment: tenant.envName,
      source,
      whatIf: isDryRun,
      placeholderAllowControls: placeholderAllowSummary ?? undefined,
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
