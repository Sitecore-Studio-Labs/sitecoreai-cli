/**
 * Brief-type recipe surface — the MCP projection of the `brief-type`
 * recipe kind. Two workflow-shaped tools:
 *
 *   - `brief_recipe_inspect` — read. `verb=pull` captures a live brief
 *     type as a declarative recipe; `verb=diff` plans the convergence of
 *     a brief type onto a given recipe. Neither writes.
 *
 *   - `brief_recipe_push` — write. Converges a brief type onto a recipe,
 *     gated by `allowWrite`; `whatIf` returns the plan without writing.
 *
 * The `recipe` input field IS `BriefTypeRecipeSchema` — the single
 * source of truth feeds the agent-facing tool surface for free. See
 * docs/recipe-sync-architecture.md.
 */
import { z } from "zod";
import { briefTypeKind } from "@/brief/recipe";
import { createScaiError } from "@/shared/errors";
import {
  summarizePlan,
  syncDiff,
  syncPull,
  syncPush,
  type RecipePlan,
  type SyncContext,
} from "@/sync";
import type { McpContext } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, whatIfShape } from "../schemas/common";

const syncContextFrom = (
  context: McpContext,
  environmentName: string | undefined,
  signal?: AbortSignal
): SyncContext => ({
  environmentName: environmentName ?? context.envName,
  configPath: context.configPath,
  signal,
});

const planSummaryText = (plan: RecipePlan): string => {
  const tally = summarizePlan(plan);
  return `Plan: ${tally.create} create, ${tally.update} update, ${tally.delete} delete, ${tally.noop} unchanged.`;
};

export const registerBriefRecipeTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "brief_recipe_inspect",
    description: TOOL_DESCRIPTIONS.brief_recipe_inspect,
    auth: "read",
    annotations: {
      title: "Pull or diff a brief type as a declarative recipe",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["pull", "diff"])
        .describe(
          "pull: capture the live brief type named `name` as a recipe. diff: compare `recipe` against the live brief type and return the plan."
        ),
      name: z.string().optional().describe("Brief type codename. Required for verb='pull'."),
      recipe: briefTypeKind.schema
        .optional()
        .describe("A brief-type recipe. Required for verb='diff'."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const ctx = syncContextFrom(context, input.environmentName);
      if (input.verb === "pull") {
        if (!input.name) {
          throw createScaiError("verb='pull' requires `name`.", "INPUT_INVALID");
        }
        const recipe = await syncPull(
          briefTypeKind,
          { kind: briefTypeKind.name, id: input.name },
          ctx
        );
        return {
          content: [
            {
              type: "text",
              text: recipe
                ? `Captured "${input.name}" as a recipe.`
                : `No brief type named "${input.name}".`,
            },
          ],
          structuredContent: { verb: input.verb, found: recipe !== null, recipe },
        };
      }
      if (!input.recipe) {
        throw createScaiError("verb='diff' requires `recipe`.", "INPUT_INVALID");
      }
      const plan = await syncDiff(
        briefTypeKind,
        input.recipe,
        { kind: briefTypeKind.name, id: input.recipe.name },
        ctx
      );
      return {
        content: [{ type: "text", text: planSummaryText(plan) }],
        structuredContent: { verb: input.verb, plan, summary: summarizePlan(plan) },
      };
    },
  });

  registry.registerTool({
    name: "brief_recipe_push",
    description: TOOL_DESCRIPTIONS.brief_recipe_push,
    auth: "write",
    annotations: {
      title: "Push a brief-type recipe — converge the type onto the recipe",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      recipe: briefTypeKind.schema.describe(
        "The brief-type recipe to converge onto. The brief type is identified by `recipe.name`."
      ),
      prune: z
        .boolean()
        .default(false)
        .describe("Include delete changes. Off by default — push is additive."),
      ...whatIfShape,
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context, extra) => {
      const ctx = syncContextFrom(context, input.environmentName, extra.signal);
      const mode = input.whatIf ? "what-if" : "apply";
      const outcome = await syncPush(
        briefTypeKind,
        input.recipe,
        { kind: briefTypeKind.name, id: input.recipe.name },
        ctx,
        { mode, prune: input.prune }
      );
      const text = outcome.result
        ? `Applied ${outcome.result.applied.length} change(s); ${outcome.result.skipped.length} skipped.`
        : planSummaryText(outcome.plan);
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          mode,
          plan: outcome.plan,
          summary: summarizePlan(outcome.plan),
          result: outcome.result,
        },
      };
    },
  });
};
