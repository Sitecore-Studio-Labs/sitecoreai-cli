/**
 * Brief domain — read + write tools.
 *
 * Two tools, workflow-shaped:
 *
 *   - `brief_inspect` (read) discriminates on `verb` so a single entry
 *     point covers list-briefs, get-brief-by-id, list/get-brief-types,
 *     list-todos (tenant-wide or per-brief), and list-comments.
 *   - `brief_manage` (write) discriminates on `resource` + `verb`:
 *     `brief-type` create/update/delete, `brief` create/update/delete
 *     (status moves go through `update` with a `status` field), and
 *     `comment` create. Brief-type writes verified 2026-05-15 against the
 *     agents tenant; brief delete uses the verified SDK `deleteBrief`;
 *     comment create is wired UNVERIFIED (best-guess body).
 */

import { z } from "zod";
import {
  runBriefCommentAdd,
  runBriefCommentsList,
  runBriefCreate,
  runBriefDelete,
  runBriefList,
  runBriefGet,
  runBriefTodosList,
  runBriefTypeCreate,
  runBriefTypeDelete,
  runBriefTypeGet,
  runBriefTypeUpdate,
  runBriefTypes,
  runBriefUpdate,
} from "@/brief/tasks";
import type { CreateBriefInput } from "@/brief";
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
        .enum(["list", "get", "types", "type", "todos", "comments"])
        .describe(
          "Which read operation to run: list (briefs), get (one brief), types (list brief schemas), type (one brief schema by id), todos, comments."
        ),
      briefId: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Brief UUID. Required for verb='get'. Optional filter for verb='todos' and verb='comments'."
        ),
      briefTypeId: z
        .string()
        .uuid()
        .optional()
        .describe("Brief type UUID. Required for verb='type'."),
      locale: z.string().optional().describe("Locale filter for verb='list' — e.g. 'en-us'."),
      assignees: z.boolean().optional().describe("Expand assignee metadata for verb='todos'."),
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
        case "get": {
          if (!input.briefId) {
            throw createScaiError("verb='get' requires `briefId`.", "INPUT_INVALID");
          }
          const result = await runBriefGet({
            ...taskOpts,
            briefId: input.briefId,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `Brief ${result.id}: '${result.name}' (${result.status}, ${result.tasks.length} to-do(s), ${result.comments.length} comment(s)).`,
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
        case "todos": {
          const result = await runBriefTodosList({
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
                  ? `${result.totalCount} to-do(s) on brief ${input.briefId}.`
                  : `${result.totalCount} to-do(s) tenant-wide.`,
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
        .enum(["brief-type", "brief", "comment"])
        .describe(
          "Which Brief resource the verb targets. 'brief-type' supports create/update/delete; 'brief' supports create/update/delete (set status via update --status); 'comment' supports create."
        ),
      verb: z
        .enum(["create", "update", "delete"])
        .describe(
          "Mutation verb. brief-type: create (POST), update (PUT-replace), delete (irreversible). brief: create (POST), update (partial PUT — pass `status` to move workflow), delete (irreversible). comment: create."
        ),
      briefTypeId: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Brief type UUID. Required for brief-type verb='update' and verb='delete', and for brief verb='create' (the type to build the brief against)."
        ),
      briefId: z
        .string()
        .uuid()
        .optional()
        .describe("Brief UUID. Required for resource='brief' verbs 'update' and 'delete'."),
      status: z
        .enum(["Draft", "InReview", "Approved", "Canceled", "Archived"])
        .optional()
        .describe(
          "Target brief status. Pass on brief verb='update' for a status-only patch (replaces the dropped set-status verb). Optional on brief 'create' (defaults to server 'Draft'). Wire form — 'InReview' is the 'In Review' UI label. A brief must leave 'Draft' before it can be linked to a campaign."
        ),
      commentText: z
        .string()
        .optional()
        .describe("Comment text. Required for resource='comment' verb='create'."),
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
          "Full BriefType body for resource='brief-type' verb='create' or verb='update'. Required on brief-type writes; ignored on delete."
        ),
      brief: z
        .object({
          name: z.string().min(1).describe("Brief display name."),
          locale: z.string().optional().describe("BCP-47-ish locale, e.g. 'en-us'."),
          fields: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Field values keyed by BriefField.name; the per-field shape follows the brief type's field definitions."
            ),
          isTemplate: z.boolean().optional().describe("Whether the brief is a template."),
        })
        .optional()
        .describe(
          "Brief body. Required for resource='brief' verb='create' (with `briefTypeId`); optional for verb='update' (any subset of name/locale/fields/isTemplate plus the top-level `status`)."
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
        if (input.verb === "create") {
          if (!input.brief) {
            throw createScaiError(
              "verb='create' on resource='brief' requires `brief`.",
              "INPUT_INVALID"
            );
          }
          if (!input.briefTypeId) {
            throw createScaiError(
              "verb='create' on resource='brief' requires `briefTypeId`.",
              "INPUT_INVALID"
            );
          }
          const createInput: CreateBriefInput = {
            name: input.brief.name,
            briefTypeId: input.briefTypeId,
            ...(input.brief.locale !== undefined && { locale: input.brief.locale }),
            ...(input.brief.fields !== undefined && { fields: input.brief.fields }),
            ...(input.brief.isTemplate !== undefined && { isTemplate: input.brief.isTemplate }),
          };
          const result = await runBriefCreate({
            ...taskOpts,
            input: createInput,
            whatIf,
          } as never);
          const isPlan = "plan" in (result as Record<string, unknown>);
          return {
            content: [
              {
                type: "text",
                text: isPlan
                  ? `Plan: create brief '${input.brief.name}'.`
                  : `Created brief '${input.brief.name}'.`,
              },
            ],
            structuredContent: { resource: input.resource, verb: input.verb, result },
          };
        }
        if (input.verb === "update") {
          if (!input.briefId) {
            throw createScaiError(
              "verb='update' on resource='brief' requires `briefId`.",
              "INPUT_INVALID"
            );
          }
          const patch: Partial<CreateBriefInput> & { status?: typeof input.status } = {
            ...(input.brief?.name !== undefined && { name: input.brief.name }),
            ...(input.brief?.locale !== undefined && { locale: input.brief.locale }),
            ...(input.brief?.fields !== undefined && { fields: input.brief.fields }),
            ...(input.brief?.isTemplate !== undefined && { isTemplate: input.brief.isTemplate }),
            ...(input.status !== undefined && { status: input.status }),
          };
          if (Object.keys(patch).length === 0) {
            throw createScaiError(
              "verb='update' on resource='brief' requires at least one field in `brief` or a top-level `status`.",
              "INPUT_INVALID"
            );
          }
          const result = await runBriefUpdate({
            ...taskOpts,
            briefId: input.briefId,
            patch,
            whatIf,
          } as never);
          const isPlan = "plan" in (result as Record<string, unknown>);
          return {
            content: [
              {
                type: "text",
                text: isPlan
                  ? `Plan: update brief ${input.briefId} (${Object.keys(patch).join(", ")}).`
                  : `Updated brief ${input.briefId}.`,
              },
            ],
            structuredContent: { resource: input.resource, verb: input.verb, result },
          };
        }
        if (input.verb === "delete") {
          if (!input.briefId) {
            throw createScaiError(
              "verb='delete' on resource='brief' requires `briefId`.",
              "INPUT_INVALID"
            );
          }
          const result = await runBriefDelete({
            ...taskOpts,
            briefId: input.briefId,
            whatIf,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: result.deleted
                  ? `Deleted brief ${input.briefId}.`
                  : `Plan: delete brief ${input.briefId}.`,
              },
            ],
            structuredContent: { resource: input.resource, verb: input.verb, result },
          };
        }
        throw createScaiError(
          "resource='brief' supports verbs 'create', 'update', and 'delete'.",
          "INPUT_INVALID"
        );
      }

      if (input.resource === "comment") {
        if (input.verb !== "create") {
          throw createScaiError("resource='comment' supports only verb='create'.", "INPUT_INVALID");
        }
        if (!input.briefId) {
          throw createScaiError(
            "verb='create' on resource='comment' requires `briefId`.",
            "INPUT_INVALID"
          );
        }
        if (!input.commentText) {
          throw createScaiError(
            "verb='create' on resource='comment' requires `commentText`.",
            "INPUT_INVALID"
          );
        }
        const result = await runBriefCommentAdd({
          ...taskOpts,
          briefId: input.briefId,
          text: input.commentText,
          whatIf,
        } as never);
        const isPlan = "plan" in (result as Record<string, unknown>);
        return {
          content: [
            {
              type: "text",
              text: isPlan
                ? `Plan: post a comment to brief ${input.briefId}.`
                : `Posted a comment to brief ${input.briefId}.`,
            },
          ],
          structuredContent: { resource: input.resource, verb: input.verb, result },
        };
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
