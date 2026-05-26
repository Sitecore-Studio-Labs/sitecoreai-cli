/**
 * Cross-domain recipe-sync MCP tool — the projection of `scai sync`.
 *
 * The per-instance `*_recipe_inspect` / `*_recipe_push` tools each
 * operate on ONE brand kit or ONE brief type. `recipe_sync` is the
 * aggregate: a single `{ verb }`-discriminated entry that fans out over
 * every enumerable recipe kind at once —
 *
 *   - `pull`   — enumerate every brand kit + brief type and capture
 *                each as a recipe file under the workspace directory.
 *   - `status` — diff every workspace recipe file against the env.
 *   - `push`   — converge every workspace recipe file onto the env
 *                (dry-run unless `whatIf: false`).
 *
 * Routing + the kinds list are shared with the CLI: `aggregatePull` /
 * `aggregateStatus` / `aggregatePush` live in `@/sync`, and the covered
 * kinds come from `@/sync/aggregate-kinds` — the same list `scai sync`
 * uses, so the two surfaces can never drift on which kinds participate.
 *
 * Verb-discriminated gating: classified `auth: "read"` so the
 * dispatch-level `allowWrite` requirement doesn't false-positive on
 * `status` (a pure read) or `pull` (writes only to the local workspace,
 * never the tenant). The `push` verb enforces `allowWrite` + the MCP
 * elevation gate inside the handler — see the runtime check below.
 */
import { z } from "zod";
import {
  aggregatePull,
  aggregatePush,
  aggregateStatus,
  DEFAULT_SYNC_DIR,
  type SyncContext,
  type SyncMode,
} from "@/sync";
import { ENUMERABLE_RECIPE_KINDS } from "@/sync/aggregate-kinds";
import { createScaiError } from "@/shared/errors";
import { ensureMcpElevationAllowed } from "@/policy/allow-write";
import { readRootConfiguration } from "@/config/root-config";
import type { McpContext } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, whatIfShape } from "../schemas/common";

const syncContextFrom = (
  context: McpContext,
  environmentName: string | undefined,
  signal: AbortSignal
): SyncContext => ({
  environmentName: environmentName ?? context.envName,
  configPath: context.configPath,
  signal,
});

export const registerRecipeSyncTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "recipe_sync",
    description: TOOL_DESCRIPTIONS.recipe_sync,
    // Verb-discriminated: `status` is a pure read, `pull` writes only
    // to the local workspace. Only `push` mutates the tenant — gated
    // inside the handler. See ToolAuth doc in registry.ts.
    auth: "verb-discriminated",
    annotations: {
      title: "Pull, diff, and push every enumerable recipe kind at once",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["pull", "status", "push"])
        .describe(
          "Which aggregate operation. `pull` enumerates every brand kit + brief type and writes each as a recipe file under `dir`. `status` diffs every recipe file in `dir` against the environment (no writes). `push` converges every recipe file onto the environment — a dry-run unless `whatIf: false`."
        ),
      dir: z
        .string()
        .optional()
        .describe(
          `Workspace directory for recipe files. Layout is <dir>/<kind>/<slug>.yaml. Defaults to '${DEFAULT_SYNC_DIR}'.`
        ),
      prune: z
        .boolean()
        .default(false)
        .describe(
          "verb='push': include delete changes. Off by default — push is additive (a recipe omitting an instance never deletes it)."
        ),
      ...whatIfShape,
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context, extra) => {
      const ctx = syncContextFrom(context, input.environmentName, extra.signal);
      const dir = input.dir;

      if (input.verb === "push") {
        if (!input.allowWrite) {
          throw createScaiError(
            "verb='push' mutates the tenant and requires allowWrite: true.",
            "INPUT_INVALID"
          );
        }
        const targetRoot = readRootConfiguration(context.configPath, ctx.environmentName);
        ensureMcpElevationAllowed(targetRoot, ctx.environmentName);
      }

      if (input.verb === "pull") {
        const result = await aggregatePull(ENUMERABLE_RECIPE_KINDS, ctx, { dir });
        const skipped = result.kinds.filter((k) => k.skipped).length;
        return {
          content: [
            {
              type: "text",
              text:
                `Pulled ${result.total} recipe(s) into ${result.dir}` +
                (skipped > 0 ? ` (${skipped} kind(s) skipped — no credential).` : "."),
            },
          ],
          structuredContent: { verb: input.verb, ...result },
        };
      }

      if (input.verb === "status") {
        const result = await aggregateStatus(ENUMERABLE_RECIPE_KINDS, ctx, { dir });
        return {
          content: [
            {
              type: "text",
              text:
                result.drifted === 0
                  ? `Everything in sync (${result.dir}).`
                  : `${result.drifted} recipe(s) drifted from the environment.`,
            },
          ],
          structuredContent: { verb: input.verb, ...result },
        };
      }

      const mode: SyncMode = input.whatIf ? "what-if" : "apply";
      const result = await aggregatePush(ENUMERABLE_RECIPE_KINDS, ctx, {
        dir,
        mode,
        prune: input.prune,
      });
      return {
        content: [
          {
            type: "text",
            text:
              mode === "apply"
                ? `Applied ${result.applied} change(s) across the workspace.`
                : "Dry run — no writes. Re-invoke with whatIf: false to converge.",
          },
        ],
        structuredContent: { verb: input.verb, ...result },
      };
    },
  });
};
