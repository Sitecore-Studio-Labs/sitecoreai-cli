/**
 * Deploy — deployment-run sub-domain.
 *
 *   - `deploy_run_inspect` (read) — list recent deployments or one
 *     deployment + status + logs.
 *   - `deploy_run_start` (write) — start (or redeploy) a deployment.
 *   - `deploy_run_cancel` (write) — cancel an in-flight deployment.
 */

import { z } from "zod";
import {
  cancelDeployment,
  createEnvironmentDeployment,
  deployDeployment,
  fetchDeployment,
  fetchDeployments,
  fetchDeploymentLogs,
  fetchEnvironmentDeployments,
} from "@/deploy/api";
import { resolveToolBinding } from "../../auth";
import { TOOL_DESCRIPTIONS } from "../../descriptions";
import type { McpRegistry } from "../../registry";
import { allowWriteShape, environmentBindingShape, paginationShape } from "../../schemas/common";
import { apiOptionsFromContext, asArray, paginate } from "./shared";

export const registerDeployRunTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_run_inspect",
    description: TOOL_DESCRIPTIONS.deploy_run_inspect,
    auth: "read",
    annotations: {
      title: "Inspect deployment run",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      deploymentId: z
        .string()
        .optional()
        .describe("Deployment ID. When omitted, lists recent deployments."),
      includeLogs: z
        .boolean()
        .default(false)
        .describe("When deploymentId is given, include the deployment logs payload."),
      ...paginationShape,
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const env = binding.resolved.environment;
      if (!input.deploymentId) {
        const list = env.environmentId
          ? asArray(await fetchEnvironmentDeployments(options, env.environmentId))
          : asArray(await fetchDeployments(options));
        const page = paginate(list, input.limit, input.cursor);
        return {
          content: [{ type: "text", text: `Listed ${page.items.length} deployment(s).` }],
          structuredContent: {
            deployments: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.nextCursor !== undefined,
          },
        };
      }
      const orgId = env.organizationId;
      const deployment = await fetchDeployment(options, input.deploymentId, orgId);
      let logs: unknown = null;
      if (input.includeLogs) {
        try {
          logs = await fetchDeploymentLogs(input.deploymentId, binding.deployToken);
        } catch {
          logs = null;
        }
      }
      return {
        content: [{ type: "text", text: `Resolved deployment '${input.deploymentId}'.` }],
        structuredContent: { deployment, logs },
      };
    },
  });

  registry.registerTool({
    name: "deploy_run_start",
    description: TOOL_DESCRIPTIONS.deploy_run_start,
    auth: "write",
    annotations: {
      title: "Start a deployment run",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      environmentId: z.string(),
      redeploy: z
        .boolean()
        .optional()
        .describe(
          "When true, redeploys the current source instead of starting a fresh deployment."
        ),
      deploymentId: z
        .string()
        .optional()
        .describe(
          "Existing deployment to (re-)run via /api/deployments/v1/{id}/deploy instead of creating a new env deployment."
        ),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      if (input.deploymentId) {
        const result = await deployDeployment(
          options,
          input.deploymentId,
          binding.resolved.environment.organizationId
        );
        return {
          content: [{ type: "text", text: `Triggered deployment '${input.deploymentId}'.` }],
          structuredContent: { mode: "deploy-existing", deploymentId: input.deploymentId, result },
        };
      }
      const result = await createEnvironmentDeployment(
        options,
        input.environmentId,
        input.redeploy
      );
      return {
        content: [
          {
            type: "text",
            text: `Created${input.redeploy ? " (redeploy)" : ""} deployment for '${input.environmentId}'.`,
          },
        ],
        structuredContent: { mode: "create", environmentId: input.environmentId, result },
      };
    },
  });

  registry.registerTool({
    name: "deploy_run_cancel",
    description: TOOL_DESCRIPTIONS.deploy_run_cancel,
    auth: "write",
    annotations: {
      title: "Cancel a deployment run",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      deploymentId: z.string(),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const result = await cancelDeployment(
        options,
        input.deploymentId,
        binding.resolved.environment.organizationId
      );
      return {
        content: [
          { type: "text", text: `Requested cancel for deployment '${input.deploymentId}'.` },
        ],
        structuredContent: { deploymentId: input.deploymentId, result },
      };
    },
  });
};
