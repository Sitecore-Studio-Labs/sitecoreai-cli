/**
 * Brief domain — read + write tools.
 *
 * Two tools, workflow-shaped:
 *
 *   - `brief_inspect` (read) discriminates on `verb` so a single entry
 *     point covers list-briefs, get-brief-by-id, list/get-brief-types,
 *     list-tasks (tenant-wide or per-brief), and list-comments.
 *   - `brief_manage` (write) is scoped to `resource: 'brief-type'` with
 *     create/update/delete verbs. Brief-type writes verified 2026-05-15
 *     against the agents tenant. Brief instance writes are wired in the
 *     SDK but not yet exposed via MCP — pending smoke testing.
 */

import { z } from "zod";
import {
  runBriefCommentsList,
  runBriefList,
  runBriefSetStatus,
  runBriefShow,
  runBriefTasksList,
  runBriefTypeCreate,
  runBriefTypeDelete,
  runBriefTypeGet,
  runBriefTypeUpdate,
  runBriefTypes,
} from "@/brief/tasks";
import type { CreateBriefTypeInput } from "@/brief/api/brief-types";
import { createScaiError } from "@/shared/errors";
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

export const registerBriefTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "brief_inspect",
    description: TOOL_DESCRIPTIONS.brief_inspect,
    auth: "read",
    annotations: {
      title: "Inspect Sitecore Brief content-ops resources",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["list", "show", "types", "type", "tasks", "comments"])
        .describe(
          "Which read operation to run: list (briefs), show (one brief), types (list brief schemas), type (one brief schema by id), tasks, comments."
        ),
      briefId: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Brief UUID. Required for verb='show'. Optional filter for verb='tasks' and verb='comments'."
        ),
      briefTypeId: z
        .string()
        .uuid()
        .optional()
        .describe("Brief type UUID. Required for verb='type'."),
      locale: z.string().optional().describe("Locale filter for verb='list' — e.g. 'en-us'."),
      assignees: z.boolean().optional().describe("Expand assignee metadata for verb='tasks'."),
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Page size for list-style verbs (default: server choice)."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const taskOpts = baseTaskOptions(
        context.configPath,
        input.environmentName ?? context.envName
      );
      switch (input.verb) {
        case "list": {
          const result = await runBriefList({
            ...taskOpts,
            ...(input.limit !== undefined && { limit: input.limit }),
            ...(input.locale !== undefined && { locale: input.locale }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `${result.totalCount} brief(s) in tenant${result.data.length < result.totalCount ? ` (showing ${result.data.length})` : ""}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "show": {
          if (!input.briefId) {
            throw createScaiError("verb='show' requires `briefId`.", "INPUT_INVALID");
          }
          const result = await runBriefShow({
            ...taskOpts,
            briefId: input.briefId,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `Brief ${result.id}: '${result.name}' (${result.status}, ${result.tasks.length} task(s), ${result.comments.length} comment(s)).`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "types": {
          const result = await runBriefTypes(taskOpts as never);
          return {
            content: [
              {
                type: "text",
                text: `${result.totalCount} brief type(s): ${result.data.map((t) => t.name).join(", ") || "(none)"}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "type": {
          if (!input.briefTypeId) {
            throw createScaiError("verb='type' requires `briefTypeId`.", "INPUT_INVALID");
          }
          const result = await runBriefTypeGet({
            ...taskOpts,
            briefTypeId: input.briefTypeId,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `Brief type ${result.id}: '${result.name}' (${result.fields.length} field(s)).`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "tasks": {
          const result = await runBriefTasksList({
            ...taskOpts,
            ...(input.briefId !== undefined && { briefId: input.briefId }),
            ...(input.assignees !== undefined && { assignees: input.assignees }),
            ...(input.limit !== undefined && { limit: input.limit }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: input.briefId
                  ? `${result.totalCount} task(s) on brief ${input.briefId}.`
                  : `${result.totalCount} task(s) tenant-wide.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "comments": {
          const result = await runBriefCommentsList({
            ...taskOpts,
            ...(input.briefId !== undefined && { briefId: input.briefId }),
            ...(input.limit !== undefined && { limit: input.limit }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: input.briefId
                  ? `${result.totalCount} comment(s) on brief ${input.briefId}.`
                  : `${result.totalCount} comment(s) tenant-wide.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "brief_manage",
    description: TOOL_DESCRIPTIONS.brief_manage,
    auth: "write",
    annotations: {
      title: "Manage Sitecore Content Operations Brief resources (brief types)",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      resource: z
        .enum(["brief-type", "brief"])
        .describe(
          "Which Brief resource the verb targets. 'brief-type' supports create/update/delete; 'brief' supports set-status."
        ),
      verb: z
        .enum(["create", "update", "delete", "set-status"])
        .describe(
          "Mutation verb. brief-type: create (POST), update (PUT-replace), delete (irreversible). brief: set-status."
        ),
      briefTypeId: z
        .string()
        .uuid()
        .optional()
        .describe("Brief type UUID. Required for brief-type verb='update' and verb='delete'."),
      briefId: z
        .string()
        .uuid()
        .optional()
        .describe("Brief UUID. Required for resource='brief' verb='set-status'."),
      status: z
        .enum(["Draft", "InReview", "Approved", "Canceled", "Archived"])
        .optional()
        .describe(
          "Target brief status for verb='set-status'. Wire form — 'InReview' is the 'In Review' UI label. A brief must leave 'Draft' before it can be linked to a campaign."
        ),
      body: z
        .object({
          name: z
            .string()
            .regex(
              /^[A-Za-z][A-Za-z0-9_]*$/,
              "Must start with a letter and contain only letters, digits, or underscores."
            ),
          label: z
            .record(z.string(), z.string())
            .describe("Localized label, keyed by BCP-47-ish locale (e.g. en-us)."),
          description: z.string(),
          icon: z.string().describe("mdi icon codepoint name."),
          iconColor: z.string().describe("Hex or named color used by the brief authoring UI."),
          fields: z
            .array(z.record(z.string(), z.unknown()))
            .describe(
              "Field definitions (RichText | DateTime | Timeline | Budget). Use brief_inspect verb='type' on an existing type for a worked example."
            ),
        })
        .optional()
        .describe(
          "Full BriefType body for verb='create' or verb='update'. Required on writes; ignored on delete."
        ),
      ...environmentBindingShape,
      ...allowWriteShape,
      ...whatIfShape,
    },
    handler: async (input, context) => {
      const taskOpts = baseTaskOptions(
        context.configPath,
        input.environmentName ?? context.envName
      );
      const whatIf = input.whatIf;

      if (input.resource === "brief") {
        if (input.verb !== "set-status") {
          throw createScaiError(
            "resource='brief' supports only verb='set-status'.",
            "INPUT_INVALID"
          );
        }
        if (!input.briefId) {
          throw createScaiError("verb='set-status' requires `briefId`.", "INPUT_INVALID");
        }
        if (!input.status) {
          throw createScaiError("verb='set-status' requires `status`.", "INPUT_INVALID");
        }
        const result = await runBriefSetStatus({
          ...taskOpts,
          briefId: input.briefId,
          status: input.status,
          whatIf,
        } as never);
        const isPlan = "plan" in (result as Record<string, unknown>);
        return {
          content: [
            {
              type: "text",
              text: isPlan
                ? `Plan: set brief ${input.briefId} status to '${input.status}'.`
                : `Brief ${input.briefId} status set to '${input.status}'.`,
            },
          ],
          structuredContent: { resource: input.resource, verb: input.verb, result },
        };
      }

      if (input.verb === "set-status") {
        throw createScaiError(
          "verb='set-status' is only valid for resource='brief'.",
          "INPUT_INVALID"
        );
      }

      switch (input.verb) {
        case "create": {
          if (!input.body) {
            throw createScaiError("verb='create' requires `body`.", "INPUT_INVALID");
          }
          const result = await runBriefTypeCreate({
            ...taskOpts,
            input: input.body as CreateBriefTypeInput,
            whatIf,
          } as never);
          const isPlan = "plan" in (result as Record<string, unknown>);
          return {
            content: [
              {
                type: "text",
                text: isPlan
                  ? `Plan: create brief type '${input.body.name}'.`
                  : `Created brief type '${input.body.name}'.`,
              },
            ],
            structuredContent: { resource: input.resource, verb: input.verb, result },
          };
        }
        case "update": {
          if (!input.briefTypeId) {
            throw createScaiError("verb='update' requires `briefTypeId`.", "INPUT_INVALID");
          }
          if (!input.body) {
            throw createScaiError("verb='update' requires `body`.", "INPUT_INVALID");
          }
          const result = await runBriefTypeUpdate({
            ...taskOpts,
            briefTypeId: input.briefTypeId,
            input: input.body as CreateBriefTypeInput,
            whatIf,
          } as never);
          const isPlan = "plan" in (result as Record<string, unknown>);
          return {
            content: [
              {
                type: "text",
                text: isPlan
                  ? `Plan: PUT-replace brief type ${input.briefTypeId}.`
                  : `Updated brief type ${input.briefTypeId}.`,
              },
            ],
            structuredContent: { resource: input.resource, verb: input.verb, result },
          };
        }
        case "delete": {
          if (!input.briefTypeId) {
            throw createScaiError("verb='delete' requires `briefTypeId`.", "INPUT_INVALID");
          }
          const result = await runBriefTypeDelete({
            ...taskOpts,
            briefTypeId: input.briefTypeId,
            whatIf,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: result.deleted
                  ? `Deleted brief type ${input.briefTypeId}.`
                  : `Plan: delete brief type ${input.briefTypeId}.`,
              },
            ],
            structuredContent: { resource: input.resource, verb: input.verb, result },
          };
        }
      }
    },
  });
};
