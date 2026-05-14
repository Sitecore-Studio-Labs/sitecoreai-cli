/**
 * `scai://env/current/*` resources — frozen-at-startup metadata for the
 * bound environment, plus a lazily-fetched "last deploy" snapshot.
 *
 * The manifest is built once during `bindMcpEnvironment` and embedded
 * in the resource handler closure; the last-deploy resource calls the
 * Deploy API on every read so it stays current within the session.
 */

import { fetchEnvironmentDeployments, fetchDeploymentLogs } from "@/deploy/api";
import type { McpRegistry } from "../registry";

export const registerEnvironmentResources = (registry: McpRegistry): void => {
  registry.registerResource({
    uri: "scai://env/current/manifest",
    name: "Bound environment manifest",
    description:
      "Static metadata for the environment the MCP server was started against — name, host, allowWrite flag, organization/project/environment ids.",
    mimeType: "application/json",
    handler: async (context) => {
      const env = context.resolved.environment;
      const manifest = {
        name: context.envName,
        configPath: context.configPath,
        allowWriteEnabled: context.allowWriteEnabled,
        organizationId: env.organizationId,
        projectId: env.projectId,
        environmentId: env.environmentId,
        environmentType: env.environmentType,
        host: env.host,
      };
      return {
        contents: [
          {
            uri: "scai://env/current/manifest",
            mimeType: "application/json",
            text: JSON.stringify(manifest, null, 2),
          },
        ],
      };
    },
  });

  registry.registerResource({
    uri: "scai://env/current/last-deploy",
    name: "Most recent deployment",
    description:
      "Most recent deployment for the bound environment, fetched lazily on read. Returns an empty payload when no deployment is found.",
    mimeType: "application/json",
    handler: async (context) => {
      const env = context.resolved.environment;
      const options = { accessToken: context.deployToken };
      const empty = {
        environment: context.envName,
        deployment: null,
        logs: null,
        message: "No deployment recorded for this environment.",
      };
      if (!env.environmentId) {
        return {
          contents: [
            {
              uri: "scai://env/current/last-deploy",
              mimeType: "application/json",
              text: JSON.stringify(empty, null, 2),
            },
          ],
        };
      }
      try {
        const deployments = await fetchEnvironmentDeployments(options, env.environmentId);
        const list = Array.isArray(deployments) ? deployments : [];
        const latest = list[0] as { id?: string } | undefined;
        if (!latest) {
          return {
            contents: [
              {
                uri: "scai://env/current/last-deploy",
                mimeType: "application/json",
                text: JSON.stringify(empty, null, 2),
              },
            ],
          };
        }
        let logs: unknown = null;
        if (latest.id) {
          try {
            logs = await fetchDeploymentLogs(latest.id, context.deployToken);
          } catch {
            logs = null;
          }
        }
        return {
          contents: [
            {
              uri: "scai://env/current/last-deploy",
              mimeType: "application/json",
              text: JSON.stringify(
                { environment: context.envName, deployment: latest, logs },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri: "scai://env/current/last-deploy",
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  environment: context.envName,
                  error: error instanceof Error ? error.message : String(error),
                  deployment: null,
                  logs: null,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    },
  });
};
