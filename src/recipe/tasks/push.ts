import path from "node:path";
import { compileRecipe } from "../compile";
import { loadIr, loadRecipe } from "../io";
import { executeIr, type ExecutionEvent, type ExecutionResult } from "../execute";
import type { OperationIr } from "../ir/operations";
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
  const { files, source } = await resolveRecipeInputs(options, tenant.root);
  const results: ExecutionResult[] = [];
  const allEvents: Array<{ recipe: string; event: ExecutionEvent }> = [];

  // Pre-compile every recipe so we can build a workspace-wide
  // refKey → expectedPath map. The executor uses this to seed
  // capturedItemIds with cross-recipe references the current recipe's
  // own ops don't produce (e.g. accordion-block's
  // `insertOptions: ["accordion-item@1"]` references accordion-item's
  // template, which lives in a different recipe's IR).
  const irs = await Promise.all(
    files.map(async (file): Promise<{ file: string; ir: OperationIr }> => {
      const ext = path.extname(file).toLowerCase();
      const ir =
        ext === ".json" && file.endsWith(".ir.json")
          ? await loadIr(file)
          : compileRecipe(await loadRecipe(file), {
              templatesRoot,
              renderingsRoot,
            });
      return { file, ir };
    })
  );

  const crossRecipeRefs = new Map<string, string>();
  for (const { ir } of irs) {
    for (const op of ir.operations) {
      if (op.op === "CreateItem") crossRecipeRefs.set(op.id, op.path);
    }
  }

  for (const { ir } of irs) {
    const result = await executeIr(ir, tenant.client, {
      mode: isDryRun ? "plan" : "apply",
      emit: (event) => allEvents.push({ recipe: ir.recipeHandle, event }),
      crossRecipeRefs,
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

  if (logger.isJson()) {
    logger.json({
      command: "recipe.push",
      environment: tenant.envName,
      source,
      whatIf: isDryRun,
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
