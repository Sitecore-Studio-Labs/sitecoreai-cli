/**
 * `environment_onboard` — stand up a new environment profile.
 *
 * Write-gated. Fills the gap where the MCP, bound to one already-healthy
 * environment at startup, had no surface to add another. Writes the
 * profile, runs the access preflight, and reports the steps that remain
 * — policy enrollment, and the human-only credential step. The MCP
 * wrapper over `runEnvironmentOnboard` (`@/setup/onboard`).
 */

import { z } from "zod";
import { runEnvironmentOnboard } from "@/setup/onboard";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape } from "../schemas/common";

export const registerOnboardTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "environment_onboard",
    description: TOOL_DESCRIPTIONS.environment_onboard,
    auth: "write",
    annotations: {
      title: "Onboard a new environment",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      environmentName: z
        .string()
        .min(1)
        .describe("Local profile name for the new environment in sitecoreai.cli.json."),
      organizationId: z.string().min(1).describe("Sitecore organization id (org_…)."),
      projectId: z.string().min(1).describe("Deploy project id the environment belongs to."),
      environmentId: z.string().min(1).describe("Deploy environment id."),
      host: z.string().min(1).describe("CM host, e.g. xmc-org-env.sitecorecloud.io."),
      environmentType: z
        .enum(["cm", "eh"])
        .default("cm")
        .describe("Environment type — cm (content management) or eh (editing host)."),
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const result = await runEnvironmentOnboard({
        config: context.configPath,
        environmentName: input.environmentName,
        organizationId: input.organizationId,
        projectId: input.projectId,
        environmentId: input.environmentId,
        host: input.host,
        environmentType: input.environmentType,
      });
      const next = result.access.nextStep;
      const text =
        `Environment '${result.environmentName}' added to sitecoreai.cli.json. ` +
        (result.access.ready
          ? "All access gates pass — it is ready to use."
          : `Not ready yet — next: ${next ? `${next.fix} [${next.actor}]` : "see access gates"}.`);
      return {
        content: [{ type: "text", text }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  });
};
