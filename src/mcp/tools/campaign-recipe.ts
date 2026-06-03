/**
 * Campaign recipe surface — the MCP projection of the `campaign` recipe
 * kind. Two workflow-shaped tools:
 *
 *   - `campaign_recipe_inspect` — read. `verb=pull` captures a live
 *     campaign as a declarative recipe; `verb=diff` plans the
 *     convergence of a campaign onto a given recipe. Neither writes.
 *
 *   - `campaign_recipe_push` — write. Converges a campaign onto a
 *     recipe, gated by `allowWrite`; `whatIf` returns the plan without
 *     writing.
 *
 * The `recipe` input field IS `CampaignRecipeSchema` — the single
 * source of truth feeds the agent-facing tool surface for free. See
 * docs/recipe-sync-architecture.md.
 */
import { z } from "zod";
import { campaignKind } from "@/campaigns/recipe";
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
import { allowWriteShape, whatIfShape } from "../schemas/common";

const syncContextFrom = (context: McpContext, signal?: AbortSignal): SyncContext => ({
  environmentName: context.envName,
  configPath: context.configPath,
  signal,
});

const planSummaryText = (plan: RecipePlan): string => {
  const tally = summarizePlan(plan);
  return `Plan: ${tally.create} create, ${tally.update} update, ${tally.delete} delete, ${tally.noop} unchanged.`;
};

export const registerCampaignRecipeTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "campaign_recipe_inspect",
    description: TOOL_DESCRIPTIONS.campaign_recipe_inspect,
    auth: "read",
    annotations: {
      title: "Pull or diff a campaign as a declarative recipe",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["pull", "diff"])
        .describe(
          "pull: capture the live campaign named `campaignName` as a recipe. diff: compare `recipe` against the live campaign and return the plan."
        ),
      campaignName: z
        .string()
        .optional()
        .describe("Campaign display name. Required for verb='pull'."),
      recipe: campaignKind.schema
        .optional()
        .describe("A campaign recipe. Required for verb='diff'."),
    },
    handler: async (input, context) => {
      const ctx = syncContextFrom(context);
      if (input.verb === "pull") {
        if (!input.campaignName) {
          throw createScaiError("verb='pull' requires `campaignName`.", "INPUT_INVALID");
        }
        const recipe = await syncPull(
          campaignKind,
          { kind: campaignKind.name, id: input.campaignName },
          ctx
        );
        return {
          content: [
            {
              type: "text",
              text: recipe
                ? `Captured "${input.campaignName}" as a recipe.`
                : `No campaign named "${input.campaignName}".`,
            },
          ],
          structuredContent: { verb: input.verb, found: recipe !== null, recipe },
        };
      }
      if (!input.recipe) {
        throw createScaiError("verb='diff' requires `recipe`.", "INPUT_INVALID");
      }
      const plan = await syncDiff(
        campaignKind,
        input.recipe,
        {
          kind: campaignKind.name,
          id: input.recipe.name,
          ...(input.recipe.handle ? { baselineKey: input.recipe.handle } : {}),
        },
        ctx
      );
      return {
        content: [{ type: "text", text: planSummaryText(plan) }],
        structuredContent: { verb: input.verb, plan, summary: summarizePlan(plan) },
      };
    },
  });

  registry.registerTool({
    name: "campaign_recipe_push",
    description: TOOL_DESCRIPTIONS.campaign_recipe_push,
    auth: "write",
    annotations: {
      title: "Push a campaign recipe — converge the campaign onto the recipe",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      recipe: campaignKind.schema.describe(
        "The campaign recipe to converge onto. The campaign is identified by `recipe.name`."
      ),
      prune: z
        .boolean()
        .default(false)
        .describe("Include delete changes. Off by default — push is additive."),
      ...whatIfShape,
      ...allowWriteShape,
    },
    handler: async (input, context, extra) => {
      const ctx = syncContextFrom(context, extra.signal);
      const mode = input.whatIf ? "what-if" : "apply";
      const outcome = await syncPush(
        campaignKind,
        input.recipe,
        {
          kind: campaignKind.name,
          id: input.recipe.name,
          ...(input.recipe.handle ? { baselineKey: input.recipe.handle } : {}),
        },
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
