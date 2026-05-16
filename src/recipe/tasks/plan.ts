import path from "node:path";
import { createScaiError } from "@/shared/errors";
import { defaultPlanPath, loadIr, writePlan } from "../io";
import { buildPlan, type Plan } from "../plan";
import { resolveTenant, toLogger, type RecipePlanOptions } from "./shared";

/**
 * `scai provision recipe plan` — read-then-diff against a tenant, no mutations.
 *
 * Operates on a pre-compiled IR file (the artifact from `scai provision recipe
 * compile`). For the recipe-source workflow, use `scai provision recipe push
 * --what-if` instead — it compiles in-memory and runs the planner.
 */
export const runRecipePlan = async (options: RecipePlanOptions): Promise<Plan> => {
  const logger = toLogger(options);
  const tenant = resolveTenant(options);
  if (!options.input) {
    throw createScaiError("--input <ir.json> is required for `recipe plan`.", "INPUT_INVALID", {
      hint: "Run `scai provision recipe compile` first, or use `scai provision recipe push --what-if` to plan from a recipe source.",
    });
  }
  const ir = await loadIr(options.input);

  const plan = await buildPlan(ir, tenant.client);

  const inputPath = options.input;
  const outputPath =
    options.output ?? defaultPlanPath(ir.recipeHandle, path.dirname(path.resolve(inputPath)));
  await writePlan(outputPath, plan);

  if (logger.isJson()) {
    logger.json({
      command: "recipe.plan",
      environment: tenant.envName,
      recipeHandle: ir.recipeHandle,
      input: inputPath,
      output: outputPath,
      summary: plan.summary,
      actions: plan.actions.map((action) => ({
        index: action.index,
        op: action.operation.op,
        label: action.operation.label,
        status: action.status,
        reason: action.reason,
        diff: action.diff,
      })),
    });
    return plan;
  }

  logger.info(`Plan for ${ir.recipeHandle} on ${tenant.envName}`, "cyan");
  for (const action of plan.actions) {
    const tag = formatActionTag(action.status);
    logger.info(`  ${tag} ${action.operation.label}${action.reason ? ` — ${action.reason}` : ""}`);
  }
  logger.info(
    `  Summary: ${plan.summary.create} create / ${plan.summary.update} update / ${plan.summary.skip} skip${
      plan.summary.error ? ` / ${plan.summary.error} error` : ""
    }`,
    plan.summary.error ? "yellow" : "green"
  );
  logger.info(`  Plan written to ${outputPath}`);
  return plan;
};

const formatActionTag = (status: Plan["actions"][number]["status"]): string => {
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
