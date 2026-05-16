/**
 * Campaign domain — read + write tools over the Sitecore Orchestrate API.
 *
 * Two tools, workflow-shaped:
 *
 *   - `campaign_inspect` (read) discriminates on `verb` — list campaigns,
 *     show one campaign (deliverables/tasks inline), list tasks under a
 *     deliverable, show one task, or list the member directory.
 *   - `campaign_manage` (write) discriminates on `resource` + `verb` —
 *     create a campaign/deliverable/task, or update a task.
 *
 * A campaign is an Orchestrate `project`. Built from a HAR capture
 * 2026-05-15; the OAuth scope is unverified — see
 * `docs/campaigns-followups.md`.
 */

import { z } from "zod";
import {
  runCampaignCreate,
  runCampaignList,
  runCampaignShow,
  runCampaignUsers,
  runDeliverableCreate,
  runTaskCreate,
  runTaskList,
  runTaskShow,
  runTaskUpdate,
} from "@/campaigns/tasks";
import { createScaiError } from "@/shared/errors";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, whatIfShape } from "../schemas/common";

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

export const registerCampaignTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "campaign_inspect",
    description: TOOL_DESCRIPTIONS.campaign_inspect,
    auth: "read",
    annotations: {
      title: "Inspect Sitecore Orchestrate campaigns",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["list", "show", "tasks", "task", "users"])
        .describe(
          "Read operation: list (campaigns), show (one campaign), tasks (list under a deliverable), task (one task), users (member directory)."
        ),
      campaignId: z
        .string()
        .uuid()
        .optional()
        .describe("Campaign UUID. Required for verb='show', 'tasks', 'task'."),
      deliverableId: z
        .string()
        .uuid()
        .optional()
        .describe("Deliverable UUID. Required for verb='tasks' and verb='task'."),
      taskId: z.string().uuid().optional().describe("Task UUID. Required for verb='task'."),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe("Page size for verb='list'."),
    },
    handler: async (input, context) => {
      const taskOpts = baseTaskOptions(context.configPath, context.envName);
      switch (input.verb) {
        case "list": {
          const result = await runCampaignList({
            ...taskOpts,
            ...(input.limit !== undefined && { limit: input.limit }),
          } as never);
          return {
            content: [{ type: "text", text: `${result.totalCount} campaign(s) in tenant.` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "show": {
          if (!input.campaignId) {
            throw createScaiError("verb='show' requires `campaignId`.", "INPUT_INVALID");
          }
          const result = await runCampaignShow({
            ...taskOpts,
            campaignId: input.campaignId,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `Campaign ${result.id}: '${result.name}' (${result.status}, ${result.deliverables.length} deliverable(s)).`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "tasks": {
          if (!input.campaignId || !input.deliverableId) {
            throw createScaiError(
              "verb='tasks' requires `campaignId` and `deliverableId`.",
              "INPUT_INVALID"
            );
          }
          const result = await runTaskList({
            ...taskOpts,
            campaignId: input.campaignId,
            deliverableId: input.deliverableId,
          } as never);
          return {
            content: [{ type: "text", text: `${result.totalCount} task(s).` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "task": {
          if (!input.campaignId || !input.deliverableId || !input.taskId) {
            throw createScaiError(
              "verb='task' requires `campaignId`, `deliverableId`, and `taskId`.",
              "INPUT_INVALID"
            );
          }
          const result = await runTaskShow({
            ...taskOpts,
            campaignId: input.campaignId,
            deliverableId: input.deliverableId,
            taskId: input.taskId,
          } as never);
          return {
            content: [
              { type: "text", text: `Task ${result.id}: '${result.name}' (${result.status}).` },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "users": {
          const result = await runCampaignUsers(taskOpts as never);
          return {
            content: [{ type: "text", text: `${result.totalCount} user(s).` }],
            structuredContent: { verb: input.verb, result },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "campaign_manage",
    description: TOOL_DESCRIPTIONS.campaign_manage,
    auth: "write",
    annotations: {
      title: "Manage Sitecore Orchestrate campaigns, deliverables, and tasks",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      resource: z
        .enum(["campaign", "deliverable", "task"])
        .describe("Which Orchestrate resource the verb targets."),
      verb: z
        .enum(["create", "update"])
        .describe(
          "Mutation verb. create: POST a new resource. update: PUT-replace (task only — full-replacement, no PATCH)."
        ),
      campaignId: z
        .string()
        .uuid()
        .optional()
        .describe("Campaign UUID. Required for deliverable/task writes."),
      deliverableId: z
        .string()
        .uuid()
        .optional()
        .describe("Deliverable UUID. Required for task writes."),
      taskId: z.string().uuid().optional().describe("Task UUID. Required for verb='update'."),
      name: z.string().optional().describe("Resource name. Required for verb='create'."),
      description: z.string().optional().describe("Description (campaign, or task — HTML)."),
      startDate: z.string().optional().describe("Start date, ISO-8601 (campaign)."),
      dueDate: z.string().optional().describe("Due date, ISO-8601."),
      status: z.string().optional().describe("Status enum, e.g. NOT_STARTED."),
      brandkitId: z.string().optional().describe("Associated brand kit UUID (campaign)."),
      funnelStage: z.string().optional().describe("Funnel stage, e.g. TOP (deliverable)."),
      funnelTactics: z
        .array(z.string())
        .optional()
        .describe("Funnel tactics (deliverable)."),
      priority: z.string().optional().describe("Task priority (task update)."),
      assignee: z.string().optional().describe("Assignee — an Auth0 subject (task update)."),
      ...allowWriteShape,
      ...whatIfShape,
    },
    handler: async (input, context) => {
      const taskOpts = baseTaskOptions(context.configPath, context.envName);
      const whatIf = input.whatIf;

      const requireName = (): string => {
        if (!input.name) {
          throw createScaiError("verb='create' requires `name`.", "INPUT_INVALID");
        }
        return input.name;
      };

      if (input.resource === "campaign") {
        if (input.verb !== "create") {
          throw createScaiError("resource='campaign' supports only verb='create'.", "INPUT_INVALID");
        }
        const result = await runCampaignCreate({
          ...taskOpts,
          whatIf,
          input: {
            name: requireName(),
            description: input.description,
            start_date: input.startDate,
            due_date: input.dueDate,
            status: input.status,
            brandkit_id: input.brandkitId,
          },
        } as never);
        return {
          content: [{ type: "text", text: `${whatIf ? "Plan: create" : "Created"} campaign.` }],
          structuredContent: { resource: input.resource, verb: input.verb, result },
        };
      }

      if (input.resource === "deliverable") {
        if (input.verb !== "create") {
          throw createScaiError(
            "resource='deliverable' supports only verb='create'.",
            "INPUT_INVALID"
          );
        }
        if (!input.campaignId) {
          throw createScaiError("deliverable create requires `campaignId`.", "INPUT_INVALID");
        }
        const result = await runDeliverableCreate({
          ...taskOpts,
          whatIf,
          campaignId: input.campaignId,
          input: {
            name: requireName(),
            due_date: input.dueDate,
            status: input.status,
            funnel_stage: input.funnelStage,
            funnel_tactics: input.funnelTactics,
          },
        } as never);
        return {
          content: [
            { type: "text", text: `${whatIf ? "Plan: create" : "Created"} deliverable.` },
          ],
          structuredContent: { resource: input.resource, verb: input.verb, result },
        };
      }

      // resource === "task"
      if (!input.campaignId || !input.deliverableId) {
        throw createScaiError(
          "task writes require `campaignId` and `deliverableId`.",
          "INPUT_INVALID"
        );
      }
      if (input.verb === "create") {
        const result = await runTaskCreate({
          ...taskOpts,
          whatIf,
          campaignId: input.campaignId,
          deliverableId: input.deliverableId,
          input: { name: requireName(), due_date: input.dueDate, status: input.status },
        } as never);
        return {
          content: [{ type: "text", text: `${whatIf ? "Plan: create" : "Created"} task.` }],
          structuredContent: { resource: input.resource, verb: input.verb, result },
        };
      }
      // verb === "update"
      if (!input.taskId) {
        throw createScaiError("task update requires `taskId`.", "INPUT_INVALID");
      }
      const result = await runTaskUpdate({
        ...taskOpts,
        whatIf,
        campaignId: input.campaignId,
        deliverableId: input.deliverableId,
        taskId: input.taskId,
        input: {
          name: requireName(),
          due_date: input.dueDate,
          status: input.status,
          priority: input.priority,
          description: input.description,
          assignee: input.assignee,
        },
      } as never);
      return {
        content: [{ type: "text", text: `${whatIf ? "Plan: update" : "Updated"} task.` }],
        structuredContent: { resource: input.resource, verb: input.verb, result },
      };
    },
  });
};
