/**
 * Deploy domain — workflow-shaped tools over scai's Deploy API surface.
 *
 * The library exports ~40 fetch/mutate primitives in `@/deploy/api`.
 * Here, those primitives are recomposed into ~9 task-shaped tools that
 * match how an agent actually reasons about an XM Cloud tenant:
 *
 *   - `*_inspect` tools fan out to read multiple resources in one call
 *     and return a coherent "snapshot" structure.
 *   - `*_manage` / `*_lifecycle` tools take a discriminated `action`
 *     input and route to the right write primitive. The dispatcher's
 *     allowWrite gate runs before any side-effecting library call.
 *
 * Never expose secret-returning library calls (edge token, editing
 * secret, source-control access tokens). Auth flows are server-side
 * only; agents reason about the bound env via deploy_environment_inspect.
 */

import { z } from "zod";
import {
  cancelDeployment,
  createEnvironmentDeployment,
  createProject,
  createProjectEnvironment,
  createSourceControlRepository,
  createSourceControlRepositoryGithub,
  deleteEnvironment,
  deleteEnvironmentVariable,
  deleteProject,
  deleteSourceControlIntegration,
  deployDeployment,
  fetchDeployment,
  fetchDeployments,
  fetchDeploymentLogs,
  fetchEnvironment,
  fetchEnvironmentDeployments,
  fetchEnvironmentRestartStatus,
  fetchEnvironmentVariables,
  fetchEnvironments,
  fetchOrganization,
  fetchOrganizationHealth,
  fetchOrganizationLicense,
  fetchProject,
  fetchProjectEnvironments,
  fetchProjects,
  fetchSourceControlIntegration,
  fetchSourceControlIntegrations,
  fetchSourceControlProviders,
  fetchSourceControlRepository,
  fetchSourceControlTemplates,
  linkEnvironmentRepository,
  linkProjectRepository,
  probeEnvironmentHealth,
  promoteEnvironmentDeployment,
  regenerateEnvironmentContext,
  resolveHostFromEnvironment,
  restartEnvironment,
  unlinkEnvironmentRepository,
  unlinkProjectRepository,
  updateEnvironment,
  updateProject,
  upsertEnvironmentVariable,
  validateSourceControlRepository,
  type DeployApiClientOptions,
} from "@/deploy/api";
import { createScaiError } from "@/shared/errors";
import { resolveToolBinding } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, paginationShape } from "../schemas/common";

const paginate = <T>(
  values: readonly T[],
  limit: number,
  cursor?: string
): { items: T[]; nextCursor?: string } => {
  const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const slice = values.slice(start, start + limit);
  const nextStart = start + slice.length;
  return {
    items: slice,
    nextCursor: nextStart < values.length ? String(nextStart) : undefined,
  };
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const apiOptionsFromContext = (token: string): DeployApiClientOptions => ({ accessToken: token });

export const registerDeployTools = (registry: McpRegistry): void => {
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

  registry.registerTool({
    name: "deploy_environment_inspect",
    description: TOOL_DESCRIPTIONS.deploy_environment_inspect,
    auth: "read",
    annotations: {
      title: "Inspect XM Cloud environment",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      environmentId: z
        .string()
        .optional()
        .describe("Environment ID. When omitted, lists all environments for the bound project."),
      projectId: z
        .string()
        .optional()
        .describe("Project filter when listing. Defaults to the bound project."),
      ...paginationShape,
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const env = binding.resolved.environment;
      if (!input.environmentId) {
        const projectId = input.projectId ?? env.projectId;
        const environments = projectId
          ? asArray(await fetchProjectEnvironments(options, projectId))
          : asArray(await fetchEnvironments(options));
        const page = paginate(environments, input.limit, input.cursor);
        return {
          content: [{ type: "text", text: `Listed ${page.items.length} environment(s).` }],
          structuredContent: {
            environments: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.nextCursor !== undefined,
          },
        };
      }
      const environmentId = input.environmentId;
      const [environment, variables, deployments, restartStatus] = await Promise.all([
        fetchEnvironment(options, environmentId),
        fetchEnvironmentVariables(options, environmentId).catch(() => []),
        fetchEnvironmentDeployments(options, environmentId).catch(() => []),
        fetchEnvironmentRestartStatus(options, environmentId).catch(() => null),
      ]);
      const host = resolveHostFromEnvironment(environment);
      const health = host ? await probeEnvironmentHealth(host).catch(() => null) : null;
      return {
        content: [
          {
            type: "text",
            text: `Environment '${environment.name ?? environmentId}' resolved (variables, deployments, restartStatus, health probe).`,
          },
        ],
        structuredContent: { environment, variables, deployments, restartStatus, health },
      };
    },
  });

  registry.registerTool({
    name: "deploy_environment_lifecycle",
    description: TOOL_DESCRIPTIONS.deploy_environment_lifecycle,
    auth: "write",
    annotations: {
      title: "Environment lifecycle write",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      action: z.enum(["create", "update", "delete", "restart", "promote", "regenerate-context"]),
      environmentId: z
        .string()
        .optional()
        .describe(
          "Environment ID. Required for update / delete / restart / promote / regenerate-context."
        ),
      projectId: z.string().optional().describe("Project ID. Required for create."),
      deploymentId: z.string().optional().describe("Deployment ID. Required for promote."),
      body: z.record(z.string(), z.unknown()).optional().describe("Create or update payload."),
      force: z.boolean().optional().describe("Optional force flag for delete."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      switch (input.action) {
        case "create": {
          if (!input.projectId) {
            throw createScaiError("`projectId` is required for action=create.", "INPUT_INVALID");
          }
          const result = await createProjectEnvironment(options, input.projectId, input.body ?? {});
          return {
            content: [
              { type: "text", text: `Created environment under project '${input.projectId}'.` },
            ],
            structuredContent: { action: "create", projectId: input.projectId, result },
          };
        }
        case "update": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=update.",
              "INPUT_INVALID"
            );
          }
          const result = await updateEnvironment(options, input.environmentId, input.body ?? {});
          return {
            content: [{ type: "text", text: `Updated environment '${input.environmentId}'.` }],
            structuredContent: { action: "update", environmentId: input.environmentId, result },
          };
        }
        case "delete": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=delete.",
              "INPUT_INVALID"
            );
          }
          const result = await deleteEnvironment(options, input.environmentId, input.force);
          return {
            content: [
              {
                type: "text",
                text: `Deleted environment '${input.environmentId}' (irreversible).`,
              },
            ],
            structuredContent: { action: "delete", environmentId: input.environmentId, result },
          };
        }
        case "restart": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=restart.",
              "INPUT_INVALID"
            );
          }
          const result = await restartEnvironment(options, input.environmentId);
          return {
            content: [{ type: "text", text: `Restart requested for '${input.environmentId}'.` }],
            structuredContent: { action: "restart", environmentId: input.environmentId, result },
          };
        }
        case "promote": {
          if (!input.environmentId || !input.deploymentId) {
            throw createScaiError(
              "`environmentId` and `deploymentId` are required for action=promote.",
              "INPUT_INVALID"
            );
          }
          const result = await promoteEnvironmentDeployment(
            options,
            input.environmentId,
            input.deploymentId
          );
          return {
            content: [
              {
                type: "text",
                text: `Promoted deployment '${input.deploymentId}' to '${input.environmentId}'.`,
              },
            ],
            structuredContent: {
              action: "promote",
              environmentId: input.environmentId,
              deploymentId: input.deploymentId,
              result,
            },
          };
        }
        case "regenerate-context": {
          if (!input.environmentId) {
            throw createScaiError(
              "`environmentId` is required for action=regenerate-context.",
              "INPUT_INVALID"
            );
          }
          const result = await regenerateEnvironmentContext(options, input.environmentId);
          return {
            content: [
              {
                type: "text",
                text: `Regenerated context for environment '${input.environmentId}'.`,
              },
            ],
            structuredContent: {
              action: "regenerate-context",
              environmentId: input.environmentId,
              result,
            },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "deploy_environment_variables",
    description: TOOL_DESCRIPTIONS.deploy_environment_variables,
    auth: "write",
    annotations: {
      title: "Upsert / delete environment variable",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      action: z.enum(["upsert", "delete"]),
      environmentId: z.string(),
      name: z.string().describe("Variable name."),
      value: z.string().optional().describe("Variable value. Required for upsert."),
      target: z
        .string()
        .optional()
        .describe(
          "Target (e.g. cm, eh) the variable applies to. Optional; defaults to the env target."
        ),
      secret: z.boolean().optional().describe("Mark as secret (true) on upsert."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      if (input.action === "upsert") {
        if (input.value === undefined) {
          throw createScaiError("`value` is required for action=upsert.", "INPUT_INVALID");
        }
        const body: Record<string, unknown> = { value: input.value };
        if (input.target !== undefined) {
          body.target = input.target;
        }
        if (input.secret !== undefined) {
          body.secret = input.secret;
        }
        const result = await upsertEnvironmentVariable(
          options,
          input.environmentId,
          input.name,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: `Upserted variable '${input.name}' on '${input.environmentId}'.`,
            },
          ],
          structuredContent: {
            action: "upsert",
            environmentId: input.environmentId,
            name: input.name,
            result,
          },
        };
      }
      const result = await deleteEnvironmentVariable(options, input.environmentId, input.name);
      return {
        content: [
          { type: "text", text: `Deleted variable '${input.name}' on '${input.environmentId}'.` },
        ],
        structuredContent: {
          action: "delete",
          environmentId: input.environmentId,
          name: input.name,
          result,
        },
      };
    },
  });

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

  registry.registerTool({
    name: "deploy_run_inspect",
    description: TOOL_DESCRIPTIONS.deploy_run_inspect,
    auth: "read",
    annotations: {
      title: "Inspect deployment run",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      deploymentId: z
        .string()
        .optional()
        .describe("Deployment ID. When omitted, lists recent deployments."),
      includeLogs: z
        .boolean()
        .default(false)
        .describe("When deploymentId is given, include the deployment logs payload."),
      ...paginationShape,
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const env = binding.resolved.environment;
      if (!input.deploymentId) {
        const list = env.environmentId
          ? asArray(await fetchEnvironmentDeployments(options, env.environmentId))
          : asArray(await fetchDeployments(options));
        const page = paginate(list, input.limit, input.cursor);
        return {
          content: [{ type: "text", text: `Listed ${page.items.length} deployment(s).` }],
          structuredContent: {
            deployments: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.nextCursor !== undefined,
          },
        };
      }
      const orgId = env.organizationId;
      const deployment = await fetchDeployment(options, input.deploymentId, orgId);
      let logs: unknown = null;
      if (input.includeLogs) {
        try {
          logs = await fetchDeploymentLogs(input.deploymentId, binding.deployToken);
        } catch {
          logs = null;
        }
      }
      return {
        content: [{ type: "text", text: `Resolved deployment '${input.deploymentId}'.` }],
        structuredContent: { deployment, logs },
      };
    },
  });

  registry.registerTool({
    name: "deploy_run_start",
    description: TOOL_DESCRIPTIONS.deploy_run_start,
    auth: "write",
    annotations: {
      title: "Start a deployment run",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      environmentId: z.string(),
      redeploy: z
        .boolean()
        .optional()
        .describe(
          "When true, redeploys the current source instead of starting a fresh deployment."
        ),
      deploymentId: z
        .string()
        .optional()
        .describe(
          "Existing deployment to (re-)run via /api/deployments/v1/{id}/deploy instead of creating a new env deployment."
        ),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      if (input.deploymentId) {
        const result = await deployDeployment(
          options,
          input.deploymentId,
          binding.resolved.environment.organizationId
        );
        return {
          content: [{ type: "text", text: `Triggered deployment '${input.deploymentId}'.` }],
          structuredContent: { mode: "deploy-existing", deploymentId: input.deploymentId, result },
        };
      }
      const result = await createEnvironmentDeployment(
        options,
        input.environmentId,
        input.redeploy
      );
      return {
        content: [
          {
            type: "text",
            text: `Created${input.redeploy ? " (redeploy)" : ""} deployment for '${input.environmentId}'.`,
          },
        ],
        structuredContent: { mode: "create", environmentId: input.environmentId, result },
      };
    },
  });

  registry.registerTool({
    name: "deploy_run_cancel",
    description: TOOL_DESCRIPTIONS.deploy_run_cancel,
    auth: "write",
    annotations: {
      title: "Cancel a deployment run",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      deploymentId: z.string(),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      const options = apiOptionsFromContext(binding.deployToken);
      const result = await cancelDeployment(
        options,
        input.deploymentId,
        binding.resolved.environment.organizationId
      );
      return {
        content: [
          { type: "text", text: `Requested cancel for deployment '${input.deploymentId}'.` },
        ],
        structuredContent: { deploymentId: input.deploymentId, result },
      };
    },
  });

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
