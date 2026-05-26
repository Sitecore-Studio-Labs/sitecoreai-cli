/**
 * Brief recipe surface — the MCP projection of both brief recipe kinds.
 * Two workflow-shaped tools, each discriminating on `kind`:
 *
 *   - `brief_recipe_inspect` — read. `verb=pull` captures a live brief
 *     type OR brief instance as a declarative recipe; `verb=diff` plans
 *     the convergence of the named resource onto a given recipe.
 *
 *   - `brief_recipe_push` — write. Converges a brief type or brief
 *     instance onto a recipe, gated by `allowWrite`; `whatIf` returns
 *     the plan without writing.
 *
 * `kind: 'brief-type'` is the legacy default (kept for back-compat with
 * the pre-instance surface). `kind: 'brief'` operates on populated
 * brief instances. The matching recipe schema becomes the input shape
 * for `recipe` automatically — the schema is the single source of truth.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { z } from "zod";
import { briefInstanceKind, briefTypeKind } from "@/brief/recipe";
import { createScaiError } from "@/shared/errors";
import {
  summarizePlan,
  syncDiff,
  syncPull,
  syncPush,
  type RecipeKind,
  type RecipePlan,
  type SyncContext,
} from "@/sync";
import type { McpContext } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, whatIfShape } from "../schemas/common";

type BriefRecipeKind = "brief-type" | "brief";

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

/** Map the MCP `kind` discriminator to the underlying `RecipeKind`. */
const recipeKindFor = (kind: BriefRecipeKind | undefined): RecipeKind<unknown> => {
  const resolved = kind ?? "brief-type";
  return resolved === "brief"
    ? (briefInstanceKind as RecipeKind<unknown>)
    : (briefTypeKind as RecipeKind<unknown>);
};

/** Both kinds carry a stable `name` — the identifier the engine matches on. */
type NamedRecipe = { name: string } & Record<string, unknown>;

export const registerBriefRecipeTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "brief_recipe_inspect",
    description: TOOL_DESCRIPTIONS.brief_recipe_inspect,
    auth: "read",
    annotations: {
      title: "Pull or diff a brief type or brief instance as a declarative recipe",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      kind: z
        .enum(["brief-type", "brief"])
        .default("brief-type")
        .describe(
          "Which recipe kind to operate on. 'brief-type' (default — the schema template) or 'brief' (a populated brief instance)."
        ),
      verb: z
        .enum(["pull", "diff"])
        .describe(
          "pull: capture the live resource named `name` as a recipe. diff: compare `recipe` against the live resource and return the plan."
        ),
      name: z
        .string()
        .optional()
        .describe("Brief-type codename or brief display name. Required for verb='pull'."),
      recipe: z
        .union([briefTypeKind.schema, briefInstanceKind.schema])
        .optional()
        .describe(
          "A brief-type recipe or brief-instance recipe (matching `kind`). Required for verb='diff'."
        ),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const ctx = syncContextFrom(context, input.environmentName);
      const kind = recipeKindFor(input.kind);
      const humanKind = input.kind === "brief" ? "brief" : "brief type";
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
                ? `Captured ${humanKind} "${input.name}" as a recipe.`
                : `No ${humanKind} named "${input.name}".`,
            },
          ],
          structuredContent: {
            kind: input.kind ?? "brief-type",
            verb: input.verb,
            found: recipe !== null,
            recipe,
          },
        };
      }
      if (!input.recipe) {
        throw createScaiError("verb='diff' requires `recipe`.", "INPUT_INVALID");
      }
      const recipe = input.recipe as NamedRecipe;
      const plan = await syncDiff(kind, recipe, { kind: kind.name, id: recipe.name }, ctx);
      return {
        content: [{ type: "text", text: planSummaryText(plan) }],
        structuredContent: {
          kind: input.kind ?? "brief-type",
          verb: input.verb,
          plan,
          summary: summarizePlan(plan),
        },
      };
    },
  });

  registry.registerTool({
    name: "brief_recipe_push",
    description: TOOL_DESCRIPTIONS.brief_recipe_push,
    auth: "write",
    annotations: {
      title: "Push a brief-type or brief recipe — converge the resource onto the recipe",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      kind: z
        .enum(["brief-type", "brief"])
        .default("brief-type")
        .describe(
          "Which recipe kind to push. 'brief-type' (default — the schema template) or 'brief' (a populated brief instance)."
        ),
      recipe: z
        .union([briefTypeKind.schema, briefInstanceKind.schema])
        .describe(
          "The recipe to converge onto. Schema must match `kind`. The resource is identified by `recipe.name`."
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
      const kind = recipeKindFor(input.kind);
      const recipe = input.recipe as NamedRecipe;
      const mode = input.whatIf ? "what-if" : "apply";
      const outcome = await syncPush(kind, recipe, { kind: kind.name, id: recipe.name }, ctx, {
        mode,
        prune: input.prune,
      });
      const text = outcome.result
        ? `Applied ${outcome.result.applied.length} change(s); ${outcome.result.skipped.length} skipped.`
        : planSummaryText(outcome.plan);
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          kind: input.kind ?? "brief-type",
          mode,
          plan: outcome.plan,
          summary: summarizePlan(outcome.plan),
          result: outcome.result,
        },
      };
    },
  });
};
