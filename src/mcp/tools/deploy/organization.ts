/**
 * Deploy — organization sub-domain.
 *
 * One read tool: a one-shot snapshot of the owning org (profile +
 * health probe + active license) before drilling into projects.
 */

import { fetchOrganization, fetchOrganizationHealth, fetchOrganizationLicense } from "@/deploy/api";
import { resolveToolBinding } from "../../auth";
import { TOOL_DESCRIPTIONS } from "../../descriptions";
import type { McpRegistry } from "../../registry";
import { environmentBindingShape } from "../../schemas/common";
import { apiOptionsFromContext } from "./shared";

export const registerDeployOrganizationTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_organization_inspect",
    description: TOOL_DESCRIPTIONS.deploy_organization_inspect,
    auth: "read",
    annotations: {
      title: "Inspect XM Cloud organization",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const organization = await fetchOrganization(options);
      const organizationId = organization.id ?? organization.organizationId;
      const [health, license] = await Promise.all([
        fetchOrganizationHealth(options, organizationId).catch(() => null),
        organizationId
          ? fetchOrganizationLicense(options, organizationId).catch(() => null)
          : Promise.resolve(null),
      ]);
      return {
        content: [
          {
            type: "text",
            text: `Organization '${organization.name ?? organizationId ?? "(unknown)"}' resolved with health + license.`,
          },
        ],
        structuredContent: { organization, health, license },
      };
    },
  });
};
