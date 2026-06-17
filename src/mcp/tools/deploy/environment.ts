/**
 * Deploy — environment sub-domain.
 *
 *   - `deploy_environment_inspect` (read) — list envs, or one env +
 *     variables + deployments + restart status + live health probe.
 *   - `deploy_environment_lifecycle` (write) — create / update / delete
 *     / restart / promote / regenerate-context via `{ action }`.
 *   - `deploy_environment_variables` (write) — upsert / delete a single
 *     environment variable.
 */

import { z } from "zod";
import {
  createProjectEnvironment,
  deleteEnvironment,
  deleteEnvironmentVariable,
  fetchEnvironment,
  fetchEnvironmentDeployments,
  fetchEnvironmentRestartStatus,
  fetchEnvironmentVariables,
  fetchEnvironments,
  fetchProjectEnvironments,
  probeEnvironmentHealth,
  promoteEnvironmentDeployment,
  regenerateEnvironmentContext,
  resolveHostFromEnvironment,
  restartEnvironment,
  updateEnvironment,
  upsertEnvironmentVariable,
} from "@/deploy/api";
import { createScaiError } from "@/shared/errors";
import { resolveToolBinding } from "../../auth";
import { TOOL_DESCRIPTIONS } from "../../descriptions";
import type { McpRegistry } from "../../registry";
import { allowWriteShape, environmentBindingShape, paginationShape } from "../../schemas/common";
import { apiOptionsFromContext, asArray, paginate } from "./shared";

const registerEnvironmentInspect = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_environment_inspect",
    description: TOOL_DESCRIPTIONS.deploy_environment_inspect,
    auth: "read",
    annotations: {
      title: "Inspect XM Cloud environment",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      environmentId: z
        .string()
        .optional()
        .describe("Environment ID. When omitted, lists all environments for the bound project."),
      projectId: z
        .string()
        .optional()
        .describe("Project filter when listing. Defaults to the bound project."),
      ...paginationShape,
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const env = binding.resolved.environment;
      if (!input.environmentId) {
        const projectId = input.projectId ?? env.projectId;
        const environments = projectId
          ? asArray(await fetchProjectEnvironments(options, projectId))
          : asArray(await fetchEnvironments(options));
        const page = paginate(environments, input.limit, input.cursor);
        return {
          content: [{ type: "text", text: `Listed ${page.items.length} environment(s).` }],
          structuredContent: {
            environments: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.nextCursor !== undefined,
          },
        };
      }
      const environmentId = input.environmentId;
      const [environment, variables, deployments, restartStatus] = await Promise.all([
        fetchEnvironment(options, environmentId),
        fetchEnvironmentVariables(options, environmentId).catch(() => []),
        fetchEnvironmentDeployments(options, environmentId).catch(() => []),
        fetchEnvironmentRestartStatus(options, environmentId).catch(() => null),
      ]);
      const host = resolveHostFromEnvironment(environment);
      const health = host ? await probeEnvironmentHealth(host).catch(() => null) : null;
      return {
        content: [
          {
            type: "text",
            text: `Environment '${environment.name ?? environmentId}' resolved (variables, deployments, restartStatus, health probe).`,
          },
        ],
        structuredContent: { environment, variables, deployments, restartStatus, health },
      };
    },
  });
};

const registerEnvironmentLifecycle = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_environment_lifecycle",
    description: TOOL_DESCRIPTIONS.deploy_environment_lifecycle,
    auth: "write",
    annotations: {
      title: "Environment lifecycle write",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      action: z.enum(["create", "update", "delete", "restart", "promote", "regenerate-context"]),
      environmentId: z
        .string()
        .optional()
        .describe(
          "Environment ID. Required for update / delete / restart / promote / regenerate-context."
        ),
      projectId: z.string().optional().describe("Project ID. Required for create."),
      deploymentId: z.string().optional().describe("Deployment ID. Required for promote."),
      body: z.record(z.string(), z.unknown()).optional().describe("Create or update payload."),
      force: z.boolean().optional().describe("Optional force flag for delete."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      switch (input.action) {
        case "create": {
          if (!input.projectId) {
            throw createScaiError("`projectId` is required for action=create.", "INPUT_INVALID");
          }
          const result = await createProjectEnvironment(options, input.projectId, input.body ?? {});
          return {
            content: [
              { type: "text", text: `Created environment under project '${input.projectId}'.` },
            ],
            structuredContent: { action: "create", projectId: input.projectId, result },
          };
        }
        case "update": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=update.",
              "INPUT_INVALID"
            );
          }
          const result = await updateEnvironment(options, input.environmentId, input.body ?? {});
          return {
            content: [{ type: "text", text: `Updated environment '${input.environmentId}'.` }],
            structuredContent: { action: "update", environmentId: input.environmentId, result },
          };
        }
        case "delete": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=delete.",
              "INPUT_INVALID"
            );
          }
          const result = await deleteEnvironment(options, input.environmentId, input.force);
          return {
            content: [
              {
                type: "text",
                text: `Deleted environment '${input.environmentId}' (irreversible).`,
              },
            ],
            structuredContent: { action: "delete", environmentId: input.environmentId, result },
          };
        }
        case "restart": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=restart.",
              "INPUT_INVALID"
            );
          }
          const result = await restartEnvironment(options, input.environmentId);
          return {
            content: [{ type: "text", text: `Restart requested for '${input.environmentId}'.` }],
            structuredContent: { action: "restart", environmentId: input.environmentId, result },
          };
        }
        case "promote": {
          if (!input.environmentId || !input.deploymentId) {
            throw createScaiError(
              "`environmentId` and `deploymentId` are required for action=promote.",
              "INPUT_INVALID"
            );
          }
          const result = await promoteEnvironmentDeployment(
            options,
            input.environmentId,
            input.deploymentId
          );
          return {
            content: [
              {
                type: "text",
                text: `Promoted deployment '${input.deploymentId}' to '${input.environmentId}'.`,
              },
            ],
            structuredContent: {
              action: "promote",
              environmentId: input.environmentId,
              deploymentId: input.deploymentId,
              result,
            },
          };
        }
        case "regenerate-context": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=regenerate-context.",
              "INPUT_INVALID"
            );
          }
          const result = await regenerateEnvironmentContext(options, input.environmentId);
          return {
            content: [
              {
                type: "text",
                text: `Regenerated context for environment '${input.environmentId}'.`,
              },
            ],
            structuredContent: {
              action: "regenerate-context",
              environmentId: input.environmentId,
              result,
            },
          };
        }
      }
    },
  });
};

const registerEnvironmentVariables = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_environment_variables",
    description: TOOL_DESCRIPTIONS.deploy_environment_variables,
    auth: "write",
    annotations: {
      title: "Upsert / delete environment variable",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      action: z.enum(["upsert", "delete"]),
      environmentId: z.string(),
      name: z.string().describe("Variable name."),
      value: z.string().optional().describe("Variable value. Required for upsert."),
      target: z
        .string()
        .optional()
        .describe(
          "Target (e.g. cm, eh) the variable applies to. Optional; defaults to the env target."
        ),
      secret: z.boolean().optional().describe("Mark as secret (true) on upsert."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      if (input.action === "upsert") {
        if (input.value === undefined) {
          throw createScaiError("`value` is required for action=upsert.", "INPUT_INVALID");
        }
        const body: Record<string, unknown> = { value: input.value };
        if (input.target !== undefined) {
          body.target = input.target;
        }
        if (input.secret !== undefined) {
          body.secret = input.secret;
        }
        const result = await upsertEnvironmentVariable(
          options,
          input.environmentId,
          input.name,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: `Upserted variable '${input.name}' on '${input.environmentId}'.`,
            },
          ],
          structuredContent: {
            action: "upsert",
            environmentId: input.environmentId,
            name: input.name,
            result,
          },
        };
      }
      const result = await deleteEnvironmentVariable(options, input.environmentId, input.name);
      return {
        content: [
          { type: "text", text: `Deleted variable '${input.name}' on '${input.environmentId}'.` },
        ],
        structuredContent: {
          action: "delete",
          environmentId: input.environmentId,
          name: input.name,
          result,
        },
      };
    },
  });
};

export const registerDeployEnvironmentTools = (registry: McpRegistry): void => {
  registerEnvironmentInspect(registry);
  registerEnvironmentLifecycle(registry);
  registerEnvironmentVariables(registry);
};
