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
import { registerBootstrapTools } from "./tools/bootstrap";
import { registerDeployTools } from "./tools/deploy";
import { registerSerializationTools } from "./tools/serialization";
import { registerRecipeTools } from "./tools/recipe";
import { registerInspectorTools } from "./tools/inspector";
import { registerWebhookTools } from "./tools/webhook";
import { registerWorkflowTools } from "./tools/workflow";
import { registerHelpResources } from "./resources/help";
import { registerEnvironmentResources } from "./resources/env";
import { registerWorkflowPrompts } from "./prompts/workflows";

export const buildScaiMcpRegistry = (): McpRegistry => {
  const registry = new McpRegistry();
  registerBootstrapTools(registry);
  registerDeployTools(registry);
  registerSerializationTools(registry);
  registerRecipeTools(registry);
  registerWorkflowTools(registry);
  registerWebhookTools(registry);
  registerInspectorTools(registry);
  registerHelpResources(registry);
  registerEnvironmentResources(registry);
  registerWorkflowPrompts(registry);
  return registry;
};
