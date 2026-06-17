/**
 * Deploy — source-control sub-domain.
 *
 *   - `deploy_repository_manage` (write) — link / unlink a repository at
 *     scope=environment or scope=project.
 *   - `deploy_source_control_inspect` (read) — integrations / providers /
 *     repository / templates via `{ scope }`.
 *   - `deploy_source_control_manage` (write) — create-repository,
 *     create-repository-github, delete-integration, validate-repository.
 */

import { z } from "zod";
import {
  createSourceControlRepository,
  createSourceControlRepositoryGithub,
  deleteSourceControlIntegration,
  fetchSourceControlIntegration,
  fetchSourceControlIntegrations,
  fetchSourceControlProviders,
  fetchSourceControlRepository,
  fetchSourceControlTemplates,
  linkEnvironmentRepository,
  linkProjectRepository,
  unlinkEnvironmentRepository,
  unlinkProjectRepository,
  validateSourceControlRepository,
} from "@/deploy/api";
import { createScaiError } from "@/shared/errors";
import { resolveToolBinding } from "../../auth";
import { TOOL_DESCRIPTIONS } from "../../descriptions";
import type { McpRegistry } from "../../registry";
import { allowWriteShape, environmentBindingShape } from "../../schemas/common";
import { apiOptionsFromContext } from "./shared";

const registerRepositoryManage = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_repository_manage",
    description: TOOL_DESCRIPTIONS.deploy_repository_manage,
    auth: "write",
    annotations: {
      title: "Link / unlink repository (project or environment)",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      scope: z.enum(["environment", "project"]),
      action: z.enum(["link", "unlink"]),
      environmentId: z.string().optional().describe("Required when scope=environment."),
      projectId: z.string().optional().describe("Required when scope=project."),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Repository link payload (integrationId, repository, branch, ...). Required for action=link."
        ),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      if (input.scope === "environment") {
        if (!input.environmentId) {
          throw createScaiError(
            "`environmentId` is required for scope=environment.",
            "INPUT_INVALID"
          );
        }
        if (input.action === "link") {
          if (!input.body) {
            throw createScaiError("`body` is required for action=link.", "INPUT_INVALID");
          }
          const result = await linkEnvironmentRepository(options, input.environmentId, input.body);
          return {
            content: [{ type: "text", text: `Linked repository on '${input.environmentId}'.` }],
            structuredContent: {
              scope: "environment",
              action: "link",
              environmentId: input.environmentId,
              result,
            },
          };
        }
        const result = await unlinkEnvironmentRepository(options, input.environmentId);
        return {
          content: [{ type: "text", text: `Unlinked repository on '${input.environmentId}'.` }],
          structuredContent: {
            scope: "environment",
            action: "unlink",
            environmentId: input.environmentId,
            result,
          },
        };
      }
      if (!input.projectId) {
        throw createScaiError("`projectId` is required for scope=project.", "INPUT_INVALID");
      }
      if (input.action === "link") {
        if (!input.body) {
          throw createScaiError("`body` is required for action=link.", "INPUT_INVALID");
        }
        const result = await linkProjectRepository(options, input.projectId, input.body);
        return {
          content: [{ type: "text", text: `Linked repository on project '${input.projectId}'.` }],
          structuredContent: {
            scope: "project",
            action: "link",
            projectId: input.projectId,
            result,
          },
        };
      }
      const result = await unlinkProjectRepository(options, input.projectId);
      return {
        content: [{ type: "text", text: `Unlinked repository on project '${input.projectId}'.` }],
        structuredContent: {
          scope: "project",
          action: "unlink",
          projectId: input.projectId,
          result,
        },
      };
    },
  });
};

const registerSourceControlInspect = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_source_control_inspect",
    description: TOOL_DESCRIPTIONS.deploy_source_control_inspect,
    auth: "read",
    annotations: {
      title: "Inspect source-control surface",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      scope: z.enum(["integrations", "providers", "repository", "templates"]),
      integrationId: z
        .string()
        .optional()
        .describe(
          "Integration ID. When provided alongside scope=integrations, returns the detail object instead of the listing."
        ),
      query: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional query bag for repository / templates scopes."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const orgId = binding.resolved.environment.organizationId;
      switch (input.scope) {
        case "integrations": {
          if (input.integrationId) {
            const integration = await fetchSourceControlIntegration(options, input.integrationId);
            return {
              content: [
                {
                  type: "text",
                  text: `Resolved source-control integration '${input.integrationId}'.`,
                },
              ],
              structuredContent: { scope: "integrations", integration },
            };
          }
          const integrations = await fetchSourceControlIntegrations(options);
          return {
            content: [{ type: "text", text: "Listed source-control integrations." }],
            structuredContent: { scope: "integrations", integrations },
          };
        }
        case "providers": {
          const providers = await fetchSourceControlProviders(options, orgId);
          return {
            content: [{ type: "text", text: "Listed source-control providers." }],
            structuredContent: { scope: "providers", providers },
          };
        }
        case "repository": {
          const repository = await fetchSourceControlRepository(
            options,
            input.query as Record<string, never> | undefined,
            orgId
          );
          return {
            content: [{ type: "text", text: "Resolved source-control repository." }],
            structuredContent: { scope: "repository", repository },
          };
        }
        case "templates": {
          const templates = await fetchSourceControlTemplates(
            options,
            input.query as Record<string, never> | undefined,
            orgId
          );
          return {
            content: [{ type: "text", text: "Listed source-control templates." }],
            structuredContent: { scope: "templates", templates },
          };
        }
      }
    },
  });
};

const registerSourceControlManage = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "deploy_source_control_manage",
    description: TOOL_DESCRIPTIONS.deploy_source_control_manage,
    auth: "write",
    annotations: {
      title: "Source-control writes",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      action: z.enum([
        "create-repository",
        "create-repository-github",
        "delete-integration",
        "validate-repository",
      ]),
      integrationId: z
        .string()
        .optional()
        .describe("Integration ID. Required for delete-integration."),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Payload for create / validate actions."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const orgId = binding.resolved.environment.organizationId;
      switch (input.action) {
        case "create-repository": {
          if (!input.body) {
            throw createScaiError(
              "`body` is required for action=create-repository.",
              "INPUT_INVALID"
            );
          }
          const result = await createSourceControlRepository(options, input.body, orgId);
          return {
            content: [{ type: "text", text: "Created source-control repository." }],
            structuredContent: { action: "create-repository", result },
          };
        }
        case "create-repository-github": {
          if (!input.body) {
            throw createScaiError(
              "`body` is required for action=create-repository-github.",
              "INPUT_INVALID"
            );
          }
          const result = await createSourceControlRepositoryGithub(options, input.body, orgId);
          return {
            content: [{ type: "text", text: "Created GitHub-backed source-control repository." }],
            structuredContent: { action: "create-repository-github", result },
          };
        }
        case "delete-integration": {
          if (!input.integrationId) {
            throw createScaiError(
              "`integrationId` is required for action=delete-integration.",
              "INPUT_INVALID"
            );
          }
          const result = await deleteSourceControlIntegration(options, input.integrationId);
          return {
            content: [
              {
                type: "text",
                text: `Deleted source-control integration '${input.integrationId}' (irreversible).`,
              },
            ],
            structuredContent: {
              action: "delete-integration",
              integrationId: input.integrationId,
              result,
            },
          };
        }
        case "validate-repository": {
          if (!input.body) {
            throw createScaiError(
              "`body` is required for action=validate-repository.",
              "INPUT_INVALID"
            );
          }
          const result = await validateSourceControlRepository(options, input.body, orgId);
          return {
            content: [{ type: "text", text: "Validated source-control repository." }],
            structuredContent: { action: "validate-repository", result },
          };
        }
      }
    },
  });
};

export const registerDeploySourceControlTools = (registry: McpRegistry): void => {
  registerRepositoryManage(registry);
  registerSourceControlInspect(registry);
  registerSourceControlManage(registry);
};
