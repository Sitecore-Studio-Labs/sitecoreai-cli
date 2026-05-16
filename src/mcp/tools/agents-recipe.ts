/**
 * Agentic Studio recipe surface — the MCP projection of the area's
 * recipe kinds. Two workflow-shaped tools, each discriminating on `kind`
 * (agent | skill | widget | custom-mcp | schema | html-template):
 *
 *   - `agents_recipe_inspect` — read. `verb=pull` captures a live
 *     resource as a recipe; `verb=diff` plans convergence onto `recipe`.
 *   - `agents_recipe_push` — write. Converges a resource onto a recipe,
 *     gated by `allowWrite`; `whatIf` returns the plan without writing.
 *
 * `recipe` is a loose object validated against the chosen kind's schema
 * in the handler — one tool covers every kind.
 */
import { z } from "zod";
import { agentRecipeKindByName } from "@/agents/recipe";
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

const KIND_NAMES = ["agent", "skill", "widget", "custom-mcp", "schema", "html-template"] as const;

const syncContextFrom = (context: McpContext, signal?: AbortSignal): SyncContext => ({
  environmentName: context.envName,
  configPath: context.configPath,
  signal,
});

const planSummaryText = (plan: RecipePlan): string => {
  const tally = summarizePlan(plan);
  return `Plan: ${tally.create} create, ${tally.update} update, ${tally.delete} delete, ${tally.noop} unchanged.`;
};

/** Extract a recipe's identifying `name`. */
const recipeName = (recipe: unknown): string => {
  const name = (recipe as { name?: unknown }).name;
  if (typeof name !== "string" || !name) {
    throw createScaiError("Recipe is missing a `name`.", "INPUT_INVALID");
  }
  return name;
};

export const registerAgentsRecipeTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "agents_recipe_inspect",
    description: TOOL_DESCRIPTIONS.agents_recipe_inspect,
    auth: "read",
    annotations: {
      title: "Pull or diff an Agentic Studio resource as a recipe",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      kind: z.enum(KIND_NAMES).describe("Which Agentic Studio resource kind the recipe describes."),
      verb: z
        .enum(["pull", "diff"])
        .describe(
          "pull: capture the resource named `name` as a recipe. diff: plan the convergence of `recipe` onto live state."
        ),
      name: z.string().optional().describe("Resource display name. Required for verb='pull'."),
      recipe: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("A recipe object. Required for verb='diff'; validated against the chosen kind."),
    },
    handler: async (input, context) => {
      const kind = agentRecipeKindByName[input.kind];
      const ctx = syncContextFrom(context);
      if (input.verb === "pull") {
        if (!input.name) {
          throw createScaiError("verb='pull' requires `name`.", "INPUT_INVALID");
        }
        const recipe = await syncPull(kind, { kind: kind.name, id: input.name }, ctx);
        return {
          content: [
            {
              type: "text",
              text: recipe
                ? `Captured "${input.name}" as a ${input.kind} recipe.`
                : `No ${input.kind} named "${input.name}".`,
            },
          ],
          structuredContent: { kind: input.kind, verb: input.verb, found: recipe !== null, recipe },
        };
      }
      if (!input.recipe) {
        throw createScaiError("verb='diff' requires `recipe`.", "INPUT_INVALID");
      }
      const recipe = kind.schema.parse(input.recipe);
      const plan = await syncDiff(kind, recipe, { kind: kind.name, id: recipeName(recipe) }, ctx);
      return {
        content: [{ type: "text", text: planSummaryText(plan) }],
        structuredContent: {
          kind: input.kind,
          verb: input.verb,
          plan,
          summary: summarizePlan(plan),
        },
      };
    },
  });

  registry.registerTool({
    name: "agents_recipe_push",
    description: TOOL_DESCRIPTIONS.agents_recipe_push,
    auth: "write",
    annotations: {
      title: "Push an Agentic Studio recipe — converge the resource onto it",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      kind: z.enum(KIND_NAMES).describe("Which Agentic Studio resource kind the recipe describes."),
      recipe: z
        .record(z.string(), z.unknown())
        .describe(
          "The recipe to converge onto. Validated against the chosen kind; the resource is identified by `recipe.name`."
        ),
      ...whatIfShape,
      ...allowWriteShape,
    },
    handler: async (input, context, extra) => {
      const kind = agentRecipeKindByName[input.kind];
      const ctx = syncContextFrom(context, extra.signal);
      const recipe = kind.schema.parse(input.recipe);
      const mode = input.whatIf ? "what-if" : "apply";
      const outcome = await syncPush(
        kind,
        recipe,
        { kind: kind.name, id: recipeName(recipe) },
        ctx,
        { mode }
      );
      const text = outcome.result
        ? `Applied ${outcome.result.applied.length} change(s); ${outcome.result.skipped.length} skipped.`
        : planSummaryText(outcome.plan);
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          kind: input.kind,
          mode,
          plan: outcome.plan,
          summary: summarizePlan(outcome.plan),
          result: outcome.result,
        },
      };
    },
  });
};
