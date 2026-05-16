/**
 * Webhook domain — inspect + manage.
 *
 *   - `webhook_inspect` (read) lists handlers or fetches one by id/path.
 *   - `webhook_manage` (write) creates an item/publish event handler or
 *     a workflow submit/validation action, and deletes any of the above.
 *
 * Mirrors the workflow tools' discriminated-verb pattern. Each handler
 * delegates to the `runWebhook*` task functions shared with the CLI.
 */

import { z } from "zod";
import { runWebhookCreate } from "@/webhooks/tasks/create";
import { runWebhookDelete } from "@/webhooks/tasks/delete";
import { runWebhookEventTypes } from "@/webhooks/tasks/event-types";
import { runWebhookInspect } from "@/webhooks/tasks/inspect";
import { runWebhookList } from "@/webhooks/tasks/list";
import { ensureMcpElevationAllowed } from "@/shared/allow-write";
import { createScaiError } from "@/shared/errors";
import { resolveToolBinding } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, whatIfShape } from "../schemas/common";

const baseTaskOptions = (
  config: string,
  envName: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  config,
  environmentName: envName,
  quiet: true,
  json: false,
  ...overrides,
});

export const registerWebhookTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "webhook_inspect",
    description: TOOL_DESCRIPTIONS.webhook_inspect,
    auth: "read",
    annotations: {
      title: "Inspect Sitecore webhook handlers",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z.enum(["list", "get", "event-types"]).describe("Which read operation to run."),
      root: z
        .string()
        .optional()
        .describe(
          "Content-tree root for verb='list' (default: /sitecore/system/Webhooks). Pass a workflow state path to list workflow-attached webhooks."
        ),
      eventType: z
        .enum(["item", "publish", "workflow"])
        .optional()
        .describe("Filter handlers by category (verb='list')."),
      enabledOnly: z.boolean().optional().describe("Return only enabled handlers (verb='list')."),
      webhook: z
        .string()
        .optional()
        .describe(
          "Item GUID or content-tree path of the webhook handler. Required for verb='get'."
        ),
      category: z
        .enum(["item", "publish"])
        .optional()
        .describe("Catalog branch for verb='event-types'. Omit to list both branches."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const taskOpts = baseTaskOptions(
        context.configPath,
        input.environmentName ?? context.envName
      );
      switch (input.verb) {
        case "list": {
          const result = await runWebhookList({
            ...taskOpts,
            ...(input.root !== undefined && { root: input.root }),
            ...(input.eventType !== undefined && { eventType: input.eventType }),
            ...(input.enabledOnly !== undefined && { enabledOnly: input.enabledOnly }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `${result.handlers.length} webhook handler(s) under ${result.rootPath}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "get": {
          if (!input.webhook) {
            throw createScaiError("verb='get' requires `webhook`.", "INPUT_INVALID");
          }
          const result = await runWebhookInspect({
            ...taskOpts,
            webhook: input.webhook,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: result
                  ? `Webhook '${result.name}' at ${result.path} (enabled=${result.fields.enabled}).`
                  : `No webhook handler found at ${input.webhook}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "event-types": {
          const result = await runWebhookEventTypes({
            ...taskOpts,
            ...(input.category !== undefined && { category: input.category }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `${result.eventTypes.length} event type(s) in tenant catalog.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "webhook_manage",
    description: TOOL_DESCRIPTIONS.webhook_manage,
    auth: "write",
    annotations: {
      title: "Create or delete a webhook handler",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z.enum(["create", "delete"]).describe("Which mutation to run."),

      // create — required for verb='create'
      name: z
        .string()
        .optional()
        .describe("Sitecore item name for the new handler (verb='create')."),
      url: z.string().optional().describe("Webhook target URL (verb='create')."),
      event: z
        .enum(["item", "publish", "workflow"])
        .optional()
        .describe("Event category (verb='create')."),
      events: z
        .array(z.string())
        .optional()
        .describe("Event-type names for item/publish flavors (e.g. ['item:saved','publish:end'])."),
      onState: z
        .string()
        .optional()
        .describe(
          "Workflow state or command path (verb='create', event='workflow'). The action item is created at <onState>/Actions/<name>."
        ),
      action: z
        .enum(["submit", "validation"])
        .optional()
        .describe("Workflow action kind (verb='create', event='workflow')."),
      description: z.string().optional().describe("Optional description on the handler."),
      authorization: z
        .string()
        .optional()
        .describe(
          "Absolute path to an Authorization item under /sitecore/system/Settings/Webhooks/Authorizations."
        ),
      serializationType: z
        .enum(["JSON", "XML"])
        .optional()
        .describe("Payload serialization (default JSON)."),
      parentPath: z.string().optional().describe("Override parent path for item/publish handlers."),
      enabled: z.boolean().optional().describe("Enable on creation. Default true."),

      // delete — required for verb='delete'
      webhook: z
        .string()
        .optional()
        .describe("Item GUID or content-tree path of the handler to delete (verb='delete')."),

      ...whatIfShape,
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      // Resolve the target environment (bound default unless retargeted
      // via `environmentName`). `denyMcpElevation` is checked against
      // the TARGET env.
      const binding = await resolveToolBinding(context, input.environmentName);
      ensureMcpElevationAllowed(binding.resolved.root, binding.envName);
      const taskOpts = baseTaskOptions(context.configPath, binding.envName);
      switch (input.verb) {
        case "create": {
          if (!input.name || !input.url || !input.event) {
            throw createScaiError(
              "verb='create' requires `name`, `url`, and `event`.",
              "INPUT_INVALID"
            );
          }
          const result = await runWebhookCreate({
            ...taskOpts,
            name: input.name,
            url: input.url,
            event: input.event,
            ...(input.events !== undefined && { events: input.events }),
            ...(input.onState !== undefined && { onState: input.onState }),
            ...(input.action !== undefined && { action: input.action }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.authorization !== undefined && { authorization: input.authorization }),
            ...(input.serializationType !== undefined && {
              serializationType: input.serializationType,
            }),
            ...(input.parentPath !== undefined && { parentPath: input.parentPath }),
            ...(input.enabled !== undefined && { enabled: input.enabled }),
            ...(input.whatIf !== undefined && { whatIf: input.whatIf }),
            ...(input.allowWrite !== undefined && { allowWrite: input.allowWrite }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text:
                  result.status === "created"
                    ? `Created webhook '${result.handler!.name}' at ${result.handler!.path}.`
                    : `Would create '${result.plan.name}' under ${result.plan.parent}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "delete": {
          if (!input.webhook) {
            throw createScaiError("verb='delete' requires `webhook`.", "INPUT_INVALID");
          }
          const result = await runWebhookDelete({
            ...taskOpts,
            webhook: input.webhook,
            ...(input.whatIf !== undefined && { whatIf: input.whatIf }),
            ...(input.allowWrite !== undefined && { allowWrite: input.allowWrite }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text:
                  result.status === "deleted"
                    ? `Deleted ${input.webhook}.`
                    : result.status === "not-found"
                      ? `No webhook handler found at ${input.webhook}.`
                      : `Would delete ${input.webhook}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
      }
    },
  });
};
