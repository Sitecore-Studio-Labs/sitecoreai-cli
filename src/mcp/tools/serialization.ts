/**
 * Serialization domain — wraps the local-vs-tenant sync flows (pull,
 * push, diff) plus inspect / validate / publish around a workflow-shaped
 * tool surface.
 *
 * `serialization_sync` consolidates `runPull` / `runPush` / `runDiff`
 * behind a single `{ direction }` discriminator. Push and diff-with-push
 * require `allowWrite: true`; pull is technically a write-to-disk but
 * remains read-class because it never mutates the tenant.
 *
 * Detailed line-item output is intentionally suppressed at the tool
 * boundary — long-form item-by-item logs would explode the response.
 * Agents re-inspect via `serialization_inspect` (filesystem) or
 * `environment_status` (tenant) after a sync to confirm the new state.
 */

import { z } from "zod";
import { runPull } from "@/serialization/tasks/pull";
import { runPush } from "@/serialization/tasks/push";
import { runDiff } from "@/serialization/tasks/diff";
import { runValidate } from "@/serialization/tasks/validate";
import { runInfo } from "@/serialization/tasks/info";
import { loadConfigAndModules } from "@/serialization/tasks/shared";
import type { SerializationProgressEvent } from "@/serialization/tasks/types";
import { publishItemSubtree } from "@/serialization/api/publish";
import { createScaiError } from "@/shared/errors";
import { ensureMcpElevationAllowed } from "@/policy/allow-write";
import { readRootConfiguration } from "@/config/root-config";
import { resolveToolBinding } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, whatIfShape } from "../schemas/common";

const baseSyncOptions = (
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

export const registerSerializationTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "serialization_inspect",
    description: TOOL_DESCRIPTIONS.serialization_inspect,
    auth: "read",
    annotations: {
      title: "Inspect serialization modules",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe(
          "Optional Sitecore item path. When provided, returns the per-subtree explanation; otherwise returns the full module set."
        ),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      const options = baseSyncOptions(context.configPath, envName);
      const { root, modules } = await loadConfigAndModules(options as never);
      // runInfo also writes to consola (stderr per our redirector) but
      // we don't need its side-effect — we already have the data shape.
      void runInfo;
      const filtered = input.path
        ? modules
            .map((module) => ({
              ...module,
              items: {
                ...module.items,
                includes: module.items.includes.filter(
                  (sub) => sub.path.toPathString().toLowerCase() === input.path!.toLowerCase()
                ),
              },
            }))
            .filter((module) => module.items.includes.length > 0)
        : modules;
      return {
        content: [
          {
            type: "text",
            text: `Resolved ${filtered.length} module(s) for environment '${envName}'.`,
          },
        ],
        structuredContent: {
          environment: envName,
          excludedFields: root.serialization.excludedFields,
          modules: filtered.map((module) => ({
            namespace: module.namespace,
            description: module.description,
            sourceIdentifier: module.sourceIdentifier,
            references: module.references,
            subtrees: module.items.includes.map((subtree) => ({
              name: subtree.name,
              database: subtree.database,
              path: subtree.path.toPathString(),
              scope: subtree.scope,
              physicalPath: subtree.physicalPath,
              allowedPushOperations: subtree.allowedPushOperations,
            })),
            roleCount: module.roles.length,
            userCount: module.users.length,
          })),
        },
      };
    },
  });

  registry.registerTool({
    name: "serialization_sync",
    description: TOOL_DESCRIPTIONS.serialization_sync,
    // Verb-discriminated gating: `pull` is read-only-to-tenant (writes
    // only to the local workspace) and `diff` without `pushOnDiff` is
    // read-only-to-tenant too. The handler enforces `allowWrite` + the
    // MCP-elevation gate only on the writing verbs (`push`, and `diff`
    // with `pushOnDiff`). See ToolAuth doc in registry.ts.
    auth: "verb-discriminated",
    annotations: {
      title: "Pull / push / diff serialized items",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      direction: z.enum(["pull", "push", "diff"]),
      path: z.string().optional().describe("Optional Sitecore item path narrow (sync only)."),
      modules: z.array(z.string()).optional().describe("Optional module namespace include filter."),
      source: z.string().optional().describe("Source environment name (direction=diff only)."),
      destination: z
        .string()
        .optional()
        .describe("Destination environment name (direction=diff only)."),
      pushOnDiff: z
        .boolean()
        .default(false)
        .describe(
          "When direction=diff, push the diff to the destination. Requires allowWrite: true."
        ),
      ...whatIfShape,
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context, extra) => {
      const envName = input.environmentName ?? context.envName;
      const isWrite =
        input.direction === "push" || (input.direction === "diff" && input.pushOnDiff);
      if (isWrite) {
        if (!input.allowWrite) {
          throw createScaiError(
            "Direction 'push' (and 'diff' with pushOnDiff) requires allowWrite: true.",
            "INPUT_INVALID"
          );
        }
        // Per-env denyMcpElevation opt-out — the dispatch-level boundary
        // gate runs only for `auth: "write"` tools, so re-enforce here
        // for the writing verbs of a verb-discriminated `auth: "read"`
        // tool. Matches dispatch.ts:88-91 for the multi-env case.
        const targetRoot = readRootConfiguration(context.configPath, envName);
        ensureMcpElevationAllowed(targetRoot, envName);
      }
      const include = input.modules ?? [];
      let dbCount = 0;
      const emit = (event: SerializationProgressEvent): void => {
        switch (event.kind) {
          case "database-start":
            dbCount += 1;
            void extra.sendProgress(
              dbCount,
              undefined,
              `Starting ${event.database} (${event.subtreeCount} subtree(s))`
            );
            break;
          case "database-changes-detected":
            void extra.sendProgress(
              dbCount,
              undefined,
              `${event.database}: ${event.changes} change(s) detected`
            );
            break;
          case "database-applied":
            void extra.sendProgress(
              dbCount,
              undefined,
              `${event.database}: applied ${event.changes} change(s)${event.whatIf ? " (whatIf)" : ""}`
            );
            break;
          case "database-skipped":
            void extra.sendProgress(
              dbCount,
              undefined,
              `${event.database}: skipped (${event.reason})`
            );
            break;
        }
      };
      const baseOptions = baseSyncOptions(context.configPath, envName, {
        whatIf: input.whatIf,
        allowWrite: input.allowWrite,
        include,
        exclude: [],
        emit,
        signal: extra.signal,
      });
      switch (input.direction) {
        case "pull":
          await runPull(baseOptions as never);
          break;
        case "push":
          await runPush(baseOptions as never);
          break;
        case "diff": {
          const diffOptions = {
            ...baseOptions,
            source: input.source ?? envName,
            destination: input.destination ?? envName,
            push: input.pushOnDiff,
            path: input.path,
          };
          await runDiff(diffOptions as never);
          break;
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `serialization ${input.direction} completed for '${envName}'${input.whatIf ? " (whatIf)" : ""}.`,
          },
        ],
        structuredContent: {
          direction: input.direction,
          environment: envName,
          whatIf: Boolean(input.whatIf),
          modulesIncluded: include,
          databasesProcessed: dbCount,
          status: "completed",
        },
      };
    },
  });

  registry.registerTool({
    name: "serialization_validate",
    description: TOOL_DESCRIPTIONS.serialization_validate,
    auth: "read",
    annotations: {
      title: "Validate serialization config",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      fix: z.boolean().default(false).describe("Attempt automatic fixes for safe issues."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      try {
        await runValidate(
          baseSyncOptions(context.configPath, envName, { fix: input.fix }) as never
        );
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `serialization validation failed for '${envName}'.`,
            },
          ],
          structuredContent: {
            valid: false,
            environment: envName,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
      return {
        content: [{ type: "text", text: `serialization validation passed for '${envName}'.` }],
        structuredContent: { valid: true, environment: envName },
      };
    },
  });

  registry.registerTool({
    name: "serialization_publish",
    description: TOOL_DESCRIPTIONS.serialization_publish,
    auth: "write",
    annotations: {
      title: "Publish item subtree",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      path: z.string().describe("Sitecore item path (master database) to publish."),
      database: z.string().default("master").describe("Source database to read the item from."),
      target: z.string().optional().describe("Optional publish target name."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const result = await publishItemSubtree(binding.resolved.environment, input.path, {
        database: input.database,
        target: input.target,
      });
      return {
        content: [
          {
            type: "text",
            text: `Published ${result.itemCount} item(s) under '${result.path}'. Job '${result.job.id}' state '${result.job.stateName}'.`,
          },
        ],
        structuredContent: {
          path: result.path,
          database: result.database,
          target: result.target,
          itemCount: result.itemCount,
          job: result.job,
        },
      };
    },
  });
};
