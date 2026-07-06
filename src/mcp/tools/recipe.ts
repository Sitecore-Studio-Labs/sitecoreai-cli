/**
 * Recipe domain — compile, plan, diff, push.
 *
 * `recipe_compile` is pure-logic and explicitly does NOT touch disk
 * (unlike the CLI counterpart, which writes the IR alongside the input).
 * The other three (plan, diff, push) talk to the bound tenant via
 * `runRecipePlan` / `runRecipeDiff` / `runRecipePush`; their CLI-shaped
 * task runners stay the contract surface so the MCP layer benefits from
 * cache reuse, retry behaviour, and execution-event collation without
 * re-implementing them.
 *
 * Inline-TS recipe sources are intentionally not supported in v1 —
 * agents should reference a recipe by file path. (A TS-source escape
 * hatch would require an in-process compile to JS and is a code-injection
 * risk that's out-of-scope for this milestone.)
 */

import { z } from "zod";
import { compileRecipe, type CompileContext } from "@/recipe/compile";
import { RecipeSchema } from "@/recipe/schema/recipe";
import { loadRecipe } from "@/recipe/io";
import { runRecipeDiff } from "@/recipe/tasks/diff";
import { runRecipePlan } from "@/recipe/tasks/plan";
import { runRecipePush } from "@/recipe/tasks/push";
import type { ExecutionEvent } from "@/recipe/runtime/execute";
import { createScaiError } from "@/shared/errors";
import { resolveToolBinding } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, whatIfShape } from "../schemas/common";

const compileContextSchema = z
  .object({
    templatesRoot: z.string().optional(),
    renderingsRoot: z.string().optional(),
    componentsRoot: z.string().optional(),
    contentModelsRoot: z.string().optional(),
    partialDesignsRoot: z.string().optional(),
    pageDesignsRoot: z.string().optional(),
    contentItemsRoot: z.string().optional(),
    headlessVariantsRoot: z.string().optional(),
    availableRenderingsRoot: z.string().optional(),
    enumerationsRoot: z.string().optional(),
  })
  .optional();

const resolveCompileContext = (
  envConfig: Record<string, unknown>,
  override: z.infer<typeof compileContextSchema>
): CompileContext => {
  const get = (key: string): string | undefined =>
    (override?.[key as keyof typeof override] as string | undefined) ??
    (envConfig[key] as string | undefined);
  const templatesRoot = get("templatesRoot");
  const renderingsRoot = get("renderingsRoot");
  if (!templatesRoot || !renderingsRoot) {
    throw createScaiError(
      "templatesRoot and renderingsRoot are required (set them in the env profile, or pass overrides in `roots`).",
      "INPUT_INVALID"
    );
  }
  return {
    templatesRoot,
    renderingsRoot,
    componentsRoot: get("componentsRoot"),
    contentModelsRoot: get("contentModelsRoot"),
    partialDesignsRoot: get("partialDesignsRoot"),
    pageDesignsRoot: get("pageDesignsRoot"),
    contentItemsRoot: get("contentItemsRoot"),
    headlessVariantsRoot: get("headlessVariantsRoot"),
    availableRenderingsRoot: get("availableRenderingsRoot"),
    enumerationsRoot: get("enumerationsRoot"),
  } as CompileContext;
};

const baseTaskOptions = (
  config: string,
  envName: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  config,
  environmentName: envName,
  quiet: true,
  json: false,
  ...overrides,
});

export const registerRecipeTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "recipe_compile",
    description: TOOL_DESCRIPTIONS.recipe_compile,
    auth: "read",
    annotations: {
      title: "Compile recipe to Operation IR",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      inputPath: z.string().optional().describe("Recipe file path (.ts or .json)."),
      inputRecipe: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Pre-parsed JSON recipe object. Mutually exclusive with inputPath."),
      roots: compileContextSchema.describe(
        "Optional overrides for the compile roots (templatesRoot, renderingsRoot, ...)."
      ),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      if (!input.inputPath && !input.inputRecipe) {
        throw createScaiError(
          "Either `inputPath` or `inputRecipe` must be provided.",
          "INPUT_INVALID"
        );
      }
      if (input.inputPath && input.inputRecipe) {
        throw createScaiError(
          "`inputPath` and `inputRecipe` are mutually exclusive.",
          "INPUT_INVALID"
        );
      }
      const recipeRaw = input.inputPath
        ? await loadRecipe(input.inputPath)
        : RecipeSchema.parse(input.inputRecipe);
      const binding = await resolveToolBinding(context, input.environmentName);
      const compileCtx = resolveCompileContext(
        binding.resolved.environment as unknown as Record<string, unknown>,
        input.roots
      );
      const ir = compileRecipe(recipeRaw, compileCtx);
      return {
        content: [
          {
            type: "text",
            text: `Compiled recipe '${ir.recipeHandle}' to ${ir.operations.length} operation(s).`,
          },
        ],
        structuredContent: { ir },
      };
    },
  });

  registry.registerTool({
    name: "recipe_diff",
    description: TOOL_DESCRIPTIONS.recipe_diff,
    auth: "read",
    annotations: {
      title: "Diff recipe against bound tenant",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      inputPath: z.string().describe("Recipe (.ts/.json) or IR (.json) file path."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      const results = await runRecipeDiff(
        baseTaskOptions(context.configPath, envName, { input: input.inputPath }) as never
      );
      return {
        content: [
          {
            type: "text",
            text: `Diffed ${results.length} recipe action(s) against '${envName}'.`,
          },
        ],
        structuredContent: { results },
      };
    },
  });

  registry.registerTool({
    name: "recipe_plan",
    description: TOOL_DESCRIPTIONS.recipe_plan,
    auth: "read",
    annotations: {
      title: "Plan recipe against bound tenant",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      inputPath: z.string().describe("Pre-compiled IR file path (.ir.json)."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      const plan = await runRecipePlan(
        baseTaskOptions(context.configPath, envName, { input: input.inputPath }) as never
      );
      const total =
        plan.summary.create + plan.summary.update + plan.summary.skip + plan.summary.error;
      return {
        content: [
          {
            type: "text",
            text: `Plan for '${plan.recipeHandle}' on '${envName}': ${total} action(s) — create:${plan.summary.create}, update:${plan.summary.update}, skip:${plan.summary.skip}, error:${plan.summary.error}.`,
          },
        ],
        structuredContent: {
          environment: envName,
          recipeHandle: plan.recipeHandle,
          summary: plan.summary,
          actions: plan.actions.map((action) => ({
            index: action.index,
            op: action.operation.op,
            status: action.status,
            reason: action.reason,
          })),
        },
      };
    },
  });

  registry.registerTool({
    name: "recipe_push",
    description: TOOL_DESCRIPTIONS.recipe_push,
    auth: "write",
    annotations: {
      title: "Push recipe to bound tenant",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      inputPath: z.string().describe("Recipe (.ts/.json) or IR (.json) file path."),
      ...whatIfShape,
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context, extra) => {
      const envName = input.environmentName ?? context.envName;
      let opCount = 0;
      const results = await runRecipePush(
        baseTaskOptions(context.configPath, envName, {
          input: input.inputPath,
          whatIf: input.whatIf,
          allowWrite: input.allowWrite,
          signal: extra.signal,
          emit: ({ recipe, event }: { recipe: string; event: ExecutionEvent }) => {
            // Translate per-op events into MCP progress notifications.
            // We don't know the total op count up-front (compileRecipeSet
            // expands at runtime), so leave `total` undefined and use
            // an incrementing progress counter the client renders.
            if (event.kind === "op-start") {
              opCount += 1;
              void extra.sendProgress(
                opCount,
                undefined,
                `[${recipe}] op ${event.index}: ${event.operation.op}`
              );
            } else if (event.kind === "apply-success") {
              void extra.sendProgress(
                opCount,
                undefined,
                `[${recipe}] applied op ${event.action.index}`
              );
            } else if (event.kind === "apply-error") {
              void extra.sendProgress(
                opCount,
                undefined,
                `[${recipe}] error op ${event.action.index}: ${event.error}`
              );
            } else if (event.kind === "apply-skip") {
              void extra.sendProgress(
                opCount,
                undefined,
                `[${recipe}] skipped op ${event.action.index}: language "${event.language}" not registered`
              );
            }
          },
        }) as never
      );
      const succeeded = results.filter((r) => !r.aborted).length;
      const failed = results.length - succeeded;
      return {
        content: [
          {
            type: "text",
            text: `Pushed ${results.length} recipe(s) to '${envName}'${input.whatIf ? " (whatIf)" : ""}: ${succeeded} succeeded, ${failed} aborted.`,
          },
        ],
        structuredContent: {
          environment: envName,
          whatIf: Boolean(input.whatIf),
          succeeded,
          failed,
          results: results.map((result) => ({
            recipeHandle: result.plan.recipeHandle,
            aborted: result.aborted,
            summary: result.summary,
            rollback: result.rollback,
          })),
        },
      };
    },
  });
};
