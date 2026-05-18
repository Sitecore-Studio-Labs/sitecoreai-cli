/**
 * `access_check` — the access preflight tool.
 *
 * Read-only and offline. Given an environment, returns every access
 * gate (config, workspace policy, credentials) at once, each with a
 * structured remediation, so an agent learns all blockers in one call
 * instead of one failed call at a time. The thin MCP wrapper over
 * `checkAccess` (`@/policy/access-check`).
 */

import { checkAccess } from "@/policy/access-check";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { environmentBindingShape } from "../schemas/common";

export const registerAccessCheckTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "access_check",
    description: TOOL_DESCRIPTIONS.access_check,
    auth: "read",
    annotations: {
      title: "Preflight environment access",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: { ...environmentBindingShape },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      const report = await checkAccess({
        configPath: context.configPath,
        environmentName: envName,
      });
      const blocked = report.gates.filter((gate) => gate.status === "blocked");
      const text = report.ready
        ? `Environment '${envName}' is ready — config, policy, and credential gates all pass.`
        : `Environment '${envName}' is NOT ready. Blocked: ${blocked
            .map((gate) => gate.id)
            .join(", ")}. Next: ${
            report.nextStep ? `${report.nextStep.fix} [${report.nextStep.actor}]` : "see gates"
          }.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: report as unknown as Record<string, unknown>,
      };
    },
  });
};
