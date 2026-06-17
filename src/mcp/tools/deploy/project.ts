/**
 * Deploy — project sub-domain.
 *
 *   - `deploy_project_inspect` (read) — list projects, or one project +
 *     its environments + limitation.
 *   - `deploy_project_manage` (write) — create / update / delete a
 *     project via a discriminated `{ action }` input.
 */

import { z } from "zod";
import {
  createProject,
  deleteProject,
  fetchProject,
  fetchProjectEnvironments,
  fetchProjects,
  updateProject,
} from "@/deploy/api";
import { createScaiError } from "@/shared/errors";
import { resolveToolBinding } from "../../auth";
import { TOOL_DESCRIPTIONS } from "../../descriptions";
import type { McpRegistry } from "../../registry";
import { allowWriteShape, environmentBindingShape, paginationShape } from "../../schemas/common";
import { apiOptionsFromContext, paginate } from "./shared";

export const registerDeployProjectTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_project_inspect",
    description: TOOL_DESCRIPTIONS.deploy_project_inspect,
    auth: "read",
    annotations: {
      title: "Inspect XM Cloud project",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      projectId: z
        .string()
        .optional()
        .describe("Project ID. When omitted, returns the full project listing."),
      ...paginationShape,
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      if (!input.projectId) {
        const projects = await fetchProjects(options);
        const page = paginate(projects, input.limit, input.cursor);
        return {
          content: [{ type: "text", text: `Listed ${page.items.length} project(s).` }],
          structuredContent: {
            projects: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.nextCursor !== undefined,
          },
        };
      }
      const [project, environments, limitation] = await Promise.all([
        fetchProject(options, input.projectId),
        fetchProjectEnvironments(options, input.projectId).catch(() => []),
        Promise.resolve(null),
      ]);
      return {
        content: [
          {
            type: "text",
            text: `Project '${project.name ?? input.projectId}' with ${environments.length} environment(s).`,
          },
        ],
        structuredContent: { project, environments, limitation },
      };
    },
  });

  registry.registerTool({
    name: "deploy_project_manage",
    description: TOOL_DESCRIPTIONS.deploy_project_manage,
    auth: "write",
    annotations: {
      title: "Create / update / delete project",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      action: z.enum(["create", "update", "delete"]),
      projectId: z.string().optional().describe("Project ID. Required for update + delete."),
      name: z.string().optional().describe("Project name. Required for create."),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Additional create/update fields passed through to the Deploy API."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      switch (input.action) {
        case "create": {
          if (!input.name) {
            throw createScaiError("`name` is required for action=create.", "INPUT_INVALID");
          }
          const result = await createProject(options, { name: input.name, ...(input.body ?? {}) });
          return {
            content: [{ type: "text", text: `Created project '${input.name}'.` }],
            structuredContent: { action: "create", result },
          };
        }
        case "update": {
          if (!input.projectId) {
            throw createScaiError("`projectId` is required for action=update.", "INPUT_INVALID");
          }
          const result = await updateProject(options, input.projectId, input.body ?? {});
          return {
            content: [{ type: "text", text: `Updated project '${input.projectId}'.` }],
            structuredContent: { action: "update", projectId: input.projectId, result },
          };
        }
        case "delete": {
          if (!input.projectId) {
            throw createScaiError("`projectId` is required for action=delete.", "INPUT_INVALID");
          }
          const result = await deleteProject(options, input.projectId);
          return {
            content: [
              { type: "text", text: `Deleted project '${input.projectId}' (irreversible).` },
            ],
            structuredContent: { action: "delete", projectId: input.projectId, result },
          };
        }
      }
    },
  });
};
