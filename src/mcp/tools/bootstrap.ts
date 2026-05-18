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
import { readRootConfiguration } from "@/config/root-config";
import { resolveCredentialMatrix, type CredentialMatrix } from "@/shared/credential-matrix";
import { HUMAN_ONLY_OPERATIONS } from "@/shared/human-only-operations";
import { resolveToolBinding } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { environmentBindingShape } from "../schemas/common";

/** One environment in the `scai_overview` discovery listing. */
type OverviewEnvironment = {
  name: string;
  bound: boolean;
  organizationId: string | null;
  projectId: string | null;
  environmentId: string | null;
  credentials: CredentialMatrix;
};

/** One organization in the `scai_overview` discovery listing. */
type OverviewOrganization = {
  organizationId: string;
  environments: string[];
  brand: boolean;
};

/**
 * Walk every configured environment and organization so an agent can
 * see the whole tenancy from one call — the navigation map for
 * per-environment targeting. Reads config only; degrades to empty
 * lists if the config can't be read (cold start, bad path).
 */
const buildDiscovery = async (
  configPath: string,
  boundEnvName: string
): Promise<{ environments: OverviewEnvironment[]; organizations: OverviewOrganization[] }> => {
  try {
    const root = readRootConfiguration(configPath, boundEnvName);
    const names = Object.keys(root.environments)
      .filter((name) => name !== "default")
      .sort((a, b) => a.localeCompare(b));

    const environments: OverviewEnvironment[] = [];
    for (const name of names) {
      const env = root.environments[name];
      const orgId = env.organizationId;
      const credentials = await resolveCredentialMatrix(
        name,
        env,
        Boolean(orgId && root.brand?.[orgId]),
        Boolean(orgId && root.orgClients?.[orgId]?.clientId)
      );
      environments.push({
        name,
        bound: name === boundEnvName,
        organizationId: env.organizationId ?? null,
        projectId: env.projectId ?? null,
        environmentId: env.environmentId ?? null,
        credentials,
      });
    }

    const orgMap = new Map<string, string[]>();
    for (const env of environments) {
      if (!env.organizationId) {
        continue;
      }
      const members = orgMap.get(env.organizationId) ?? [];
      members.push(env.name);
      orgMap.set(env.organizationId, members);
    }
    const organizations: OverviewOrganization[] = [...orgMap.entries()].map(
      ([organizationId, envs]) => ({
        organizationId,
        environments: envs,
        brand: Boolean(root.brand?.[organizationId]),
      })
    );

    return { environments, organizations };
  } catch {
    // Cold start / unreadable config — the overview still returns the
    // server inventory; discovery is best-effort.
    return { environments: [], organizations: [] };
  }
};

const TOOL_DOMAINS = ["deploy", "serialization", "recipe", "bootstrap", "inspector"] as const;

const RESOURCE_URIS = [
  "scai://help/overview",
  "scai://help/access-and-policy",
  "scai://help/recipes-grammar",
  "scai://help/deploy-lifecycle",
  "scai://help/sitecore-apis",
  "scai://env/current/manifest",
  "scai://env/current/last-deploy",
  "https://api-docs.sitecore.com/",
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
      const { environments, organizations } = await buildDiscovery(
        context.configPath,
        context.envName
      );
      const summary = {
        server: { name: "scai", version: packageJson.version },
        environment: {
          name: context.envName,
          configPath: context.configPath,
          allowWriteEnabled: context.allowWriteEnabled,
        },
        // Discovery map — every configured environment + organization,
        // each with its credential matrix. The bound environment is
        // flagged `bound: true`.
        environments,
        organizations,
        toolDomains: [...TOOL_DOMAINS],
        toolCount: registry.listTools().length,
        resourceUris: [...RESOURCE_URIS],
        promptCount: registry.listPrompts().length,
        // Operations no agent / CI / MCP caller can perform — a human
        // must run them in a terminal. Declared up front so an agent
        // routes around them instead of discovering it via a refusal.
        humanOnlyOperations: HUMAN_ONLY_OPERATIONS,
      };
      const discovery =
        environments.length > 0
          ? `${environments.length} environment(s) across ${organizations.length} organization(s). `
          : "";
      const text =
        `scai MCP server ${packageJson.version} bound to '${context.envName}'. ` +
        `${discovery}${summary.toolCount} tool(s), ${summary.resourceUris.length} resource(s), ` +
        `${summary.promptCount} prompt(s). Writes require allowWrite: true on each call. ` +
        `Credential provisioning (login, client mint) is human-terminal-only — see humanOnlyOperations.`;
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
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const env = binding.resolved.environment;
      const apiOptions = { accessToken: binding.deployToken };

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
        `Environment '${binding.envName}': health ${health.ok ? "OK" : "NOT OK"} (status ${health.status}). ` +
        `${recentDeployments.length} recent deployment(s) considered.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          environment: {
            name: binding.envName,
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
