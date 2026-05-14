/**
 * Bootstrap tools — `scai_overview` is the first call an agent makes
 * from a cold start; `environment_status` is the live-pulse probe.
 *
 * Both are read-only and never gate on `allowWrite`.
 */

import { z } from "zod";
import packageJson from "../../../package.json";
import {
  fetchEnvironment,
  fetchEnvironmentDeployments,
  probeEnvironmentHealth,
  resolveHostFromEnvironment,
  type DeployEnvironment,
} from "@/deploy/api";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";

const TOOL_DOMAINS = ["deploy", "serialization", "recipe", "bootstrap", "inspector"] as const;

const RESOURCE_URIS = [
  "scai://help/overview",
  "scai://help/recipes-grammar",
  "scai://help/deploy-lifecycle",
  "scai://env/current/manifest",
  "scai://env/current/last-deploy",
] as const;

export const registerBootstrapTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "scai_overview",
    description: TOOL_DESCRIPTIONS.scai_overview,
    auth: "read",
    annotations: {
      title: "Overview of this MCP server",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {},
    handler: async (_input, context) => {
      const summary = {
        server: { name: "scai", version: packageJson.version },
        environment: {
          name: context.envName,
          configPath: context.configPath,
          allowWriteEnabled: context.allowWriteEnabled,
        },
        toolDomains: [...TOOL_DOMAINS],
        toolCount: registry.listTools().length,
        resourceUris: [...RESOURCE_URIS],
        promptCount: registry.listPrompts().length,
      };
      const text =
        `scai MCP server ${packageJson.version} bound to '${context.envName}'. ` +
        `${summary.toolCount} tool(s), ${summary.resourceUris.length} resource(s), ` +
        `${summary.promptCount} prompt(s). Writes require allowWrite: true on each call.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: summary,
      };
    },
  });

  registry.registerTool({
    name: "environment_status",
    description: TOOL_DESCRIPTIONS.environment_status,
    auth: "read",
    annotations: {
      title: "Probe bound environment status",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      includeDeployments: z
        .boolean()
        .default(true)
        .describe("When true, include the 5 most recent deployments alongside the health probe."),
    },
    handler: async (input, context) => {
      const env = context.resolved.environment;
      const apiOptions = { accessToken: context.deployToken };

      let deployEnvironment: DeployEnvironment | undefined;
      if (env.environmentId) {
        try {
          deployEnvironment = await fetchEnvironment(apiOptions, env.environmentId);
        } catch {
          deployEnvironment = undefined;
        }
      }
      const host = deployEnvironment ? resolveHostFromEnvironment(deployEnvironment) : undefined;
      const health = host
        ? await probeEnvironmentHealth(host)
        : {
            host: "",
            url: "",
            status: 0,
            ok: false,
            body: "No CM host resolvable for this environment.",
          };

      let recentDeployments: unknown[] = [];
      if (input.includeDeployments && env.environmentId) {
        try {
          const deployments = await fetchEnvironmentDeployments(apiOptions, env.environmentId);
          if (Array.isArray(deployments)) {
            recentDeployments = deployments.slice(0, 5);
          }
        } catch {
          recentDeployments = [];
        }
      }

      const text =
        `Environment '${context.envName}': health ${health.ok ? "OK" : "NOT OK"} (status ${health.status}). ` +
        `${recentDeployments.length} recent deployment(s) considered.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          environment: {
            name: context.envName,
            organizationId: env.organizationId,
            projectId: env.projectId,
            environmentId: env.environmentId,
            cmHost: host,
          },
          health,
          recentDeployments,
        },
      };
    },
  });
};
