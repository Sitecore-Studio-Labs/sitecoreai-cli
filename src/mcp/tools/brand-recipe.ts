/**
 * Brand-kit recipe surface — the MCP projection of the `brand-kit`
 * recipe kind. Two workflow-shaped tools:
 *
 *   - `brand_recipe_inspect` — read. `verb=pull` captures a live kit as
 *     a declarative recipe; `verb=diff` plans the convergence of a kit
 *     onto a given recipe. Neither writes.
 *
 *   - `brand_recipe_push` — write. Converges a kit onto a recipe, gated
 *     by `allowWrite`; `whatIf` returns the plan without writing.
 *
 * The `recipe` input field IS `BrandKitRecipeSchema` — the single source
 * of truth feeds the agent-facing tool surface for free. See
 * docs/recipe-sync-architecture.md.
 */
import { z } from "zod";
import { brandKitKind } from "@/brand/recipe";
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

export const registerBrandRecipeTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "brand_recipe_inspect",
    description: TOOL_DESCRIPTIONS.brand_recipe_inspect,
    auth: "read",
    annotations: {
      title: "Pull or diff a brand kit as a declarative recipe",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["pull", "diff"])
        .describe(
          "pull: capture the live brand kit named `kitName` as a recipe. diff: compare `recipe` against the live kit and return the plan."
        ),
      kitName: z.string().optional().describe("Brand kit display name. Required for verb='pull'."),
      recipe: brandKitKind.schema
        .optional()
        .describe("A brand-kit recipe. Required for verb='diff'."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const ctx = syncContextFrom(context, input.environmentName);
      if (input.verb === "pull") {
        if (!input.kitName) {
          throw createScaiError("verb='pull' requires `kitName`.", "INPUT_INVALID");
        }
        const recipe = await syncPull(
          brandKitKind,
          { kind: brandKitKind.name, id: input.kitName },
          ctx
        );
        return {
          content: [
            {
              type: "text",
              text: recipe
                ? `Captured "${input.kitName}" as a recipe.`
                : `No brand kit named "${input.kitName}".`,
            },
          ],
          structuredContent: { verb: input.verb, found: recipe !== null, recipe },
        };
      }
      if (!input.recipe) {
        throw createScaiError("verb='diff' requires `recipe`.", "INPUT_INVALID");
      }
      const plan = await syncDiff(
        brandKitKind,
        input.recipe,
        { kind: brandKitKind.name, id: input.recipe.name },
        ctx
      );
      return {
        content: [{ type: "text", text: planSummaryText(plan) }],
        structuredContent: { verb: input.verb, plan, summary: summarizePlan(plan) },
      };
    },
  });

  registry.registerTool({
    name: "brand_recipe_push",
    description: TOOL_DESCRIPTIONS.brand_recipe_push,
    auth: "write",
    annotations: {
      title: "Push a brand kit recipe — converge the kit onto the recipe",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      recipe: brandKitKind.schema.describe(
        "The brand-kit recipe to converge onto. The kit is identified by `recipe.name`."
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
        brandKitKind,
        input.recipe,
        { kind: brandKitKind.name, id: input.recipe.name },
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
