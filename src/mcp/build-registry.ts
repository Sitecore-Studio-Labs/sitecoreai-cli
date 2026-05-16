/**
 * Single-source-of-truth assembly for the MCP registry.
 *
 * Lives in its own file so both the runtime server and the offline
 * `scai mcp tools list / schema` inspector commands share the same
 * registration order — without needing a live `McpContext`.
 *
 * The inspector commands instantiate a registry from this helper, then
 * walk the descriptors directly; no SDK wiring required.
 */

import { McpRegistry } from "./registry";
import { registerAuditTools } from "./tools/audit";
import { registerBootstrapTools } from "./tools/bootstrap";
import { registerBrandTools } from "./tools/brand";
import { registerBrandRecipeTools } from "./tools/brand-recipe";
import { registerBriefTools } from "./tools/brief";
import { registerBriefRecipeTools } from "./tools/brief-recipe";
import { registerCampaignTools } from "./tools/campaign";
import { registerCampaignRecipeTools } from "./tools/campaign-recipe";
import { registerAgentsTools } from "./tools/agents";
import { registerAgentsRecipeTools } from "./tools/agents-recipe";
import { registerCleanupTools } from "./tools/cleanup";
import { registerDeployTools } from "./tools/deploy";
import { registerPublishingTools } from "./tools/publish";
import { registerSerializationTools } from "./tools/serialization";
import { registerRecipeTools } from "./tools/recipe";
import { registerInspectorTools } from "./tools/inspector";
import { registerWebhookTools } from "./tools/webhook";
import { registerWorkflowTools } from "./tools/workflow";
import { registerBrandResources } from "./resources/brand";
import { registerHelpResources } from "./resources/help";
import { registerEnvironmentResources } from "./resources/env";
import { registerRecipeResources } from "./resources/recipes";
import { registerWorkflowPrompts } from "./prompts/workflows";

export const buildScaiMcpRegistry = (): McpRegistry => {
  const registry = new McpRegistry();
  registerBootstrapTools(registry);
  registerDeployTools(registry);
  registerSerializationTools(registry);
  registerRecipeTools(registry);
  registerWorkflowTools(registry);
  registerWebhookTools(registry);
  registerAuditTools(registry);
  registerCleanupTools(registry);
  registerPublishingTools(registry);
  registerBrandTools(registry);
  registerBrandRecipeTools(registry);
  registerBriefTools(registry);
  registerBriefRecipeTools(registry);
  registerCampaignTools(registry);
  registerCampaignRecipeTools(registry);
  registerAgentsTools(registry);
  registerAgentsRecipeTools(registry);
  registerInspectorTools(registry);
  registerHelpResources(registry);
  registerEnvironmentResources(registry);
  registerRecipeResources(registry);
  registerBrandResources(registry);
  registerWorkflowPrompts(registry);
  return registry;
};
