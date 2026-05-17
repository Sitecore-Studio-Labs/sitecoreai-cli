import {
  fetchProjects,
  fetchAllProjects,
  fetchProjectsLimitation,
  validateProjectName,
  fetchProject,
  createProject,
  updateProject,
  deleteProject,
  linkProjectRepository,
  unlinkProjectRepository,
} from "@/deploy/api/projects";
import { ScaiError, createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { ensureAllowWrite } from "@/shared/allow-write";
import {
  confirmDestructive,
  getDeployContext,
  inputError,
  printDeployResultWithContext,
  printDeployWhatIf,
  selectMatch,
  toLogger,
} from "./shared";
import type {
  DeployBaseOptions,
  DeployProjectCreateOptions,
  DeployProjectDeleteOptions,
  DeployProjectNameValidationOptions,
  DeployProjectOptions,
  DeployProjectRepositoryLinkOptions,
  DeployProjectUpdateOptions,
} from "./types";

export type DeployProjectsListOptions = DeployBaseOptions & {
  all?: boolean;
  page?: number;
  pageSize?: number;
};

export const runDeployProjectsList = async (options: DeployProjectsListOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const apiOptions = { accessToken: context.token, baseUrl: context.baseUrl };
  if (options.all) {
    const aggregated = await fetchAllProjects(apiOptions, options.pageSize ?? 50);
    const result = {
      totalCount: aggregated.totalCount,
      pageSize: aggregated.pageSize,
      data: aggregated.items,
    };
    printDeployResultWithContext(logger, context, "deploy.projects.list", result);
    return;
  }
  const result = await fetchProjects(apiOptions, {
    PageNumber: options.page,
    PageSize: options.pageSize,
  });
  printDeployResultWithContext(logger, context, "deploy.projects.list", result);
};

/**
 * Resolve a project name/ID to a concrete projectId. Walks every page
 * of `/api/projects/v2` so orgs with >10 projects don't see spurious
 * "not found" errors on the second page and beyond.
 */
const lookupProjectIdByNameOrId = async (
  context: { token: string; baseUrl?: string },
  selection: string
): Promise<string | undefined> => {
  const aggregated = await fetchAllProjects({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  const project = selectMatch(aggregated.items, "Project", selection);
  return project.id ?? project.projectId;
};

export const runDeployProjectsLimitation = async (options: DeployBaseOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const result = await fetchProjectsLimitation({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  printDeployResultWithContext(logger, context, "deploy.projects.limitation", result);
};

export const runDeployProjectsValidateName = async (
  options: DeployProjectNameValidationOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.name) {
    throw inputError("Project name is required. Use --name.");
  }
  const result = await validateProjectName(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.name
  );
  printDeployResultWithContext(logger, context, "deploy.projects.validate-name", result);
};

export const runDeployProjectsGet = async (options: DeployProjectOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const id = options.id ?? options.name ?? context.projectId;
  if (!id) {
    throw inputError("Project ID is required. Use --id/--name or set it in config.");
  }
  const result = await fetchProject({ accessToken: context.token, baseUrl: context.baseUrl }, id);
  printDeployResultWithContext(logger, context, "deploy.projects.get", result);
};

export const runDeployProjectsCreate = async (
  options: DeployProjectCreateOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.name) {
    throw inputError("Project name is required. Use --name.");
  }
  const body: Record<string, unknown> = { name: options.name };
  if (options.repositoryName !== undefined) {
    body.repository = options.repositoryName;
  }
  if (options.repositoryId !== undefined) {
    body.repositoryId = options.repositoryId;
  }
  if (options.sourceControlIntegrationId !== undefined) {
    body.integrationId = options.sourceControlIntegrationId;
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.projects.create", {
      method: "POST",
      path: "/api/projects/v1",
      body,
    });
    return;
  }

  const result = await createProject(
    { accessToken: context.token, baseUrl: context.baseUrl },
    body
  );
  printDeployResultWithContext(logger, context, "deploy.projects.create", result);
};

export const runDeployProjectsDelete = async (
  options: DeployProjectDeleteOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const selection = options.id ?? options.name;
  if (!selection) {
    throw inputError("Project name or ID is required. Use --name or --id.");
  }
  if (options.whatIf) {
    if (!options.id) {
      throw createScaiError("Project ID is required for --what-if. Use --id.", "INPUT_INVALID", {
        hint: "Provide an explicit project ID to avoid lookup calls.",
      });
    }
    printDeployWhatIf(logger, context, "deploy.projects.delete", {
      method: "DELETE",
      path: `/api/projects/v1/${options.id}`,
    });
    return;
  }
  // Destructive-tier policy gate — project deletion is irreversible.
  // Refused for m2m / mcp callers and for CI without ciWrites; a no-op in
  // unmanaged mode. See docs/policy-and-guardrails.md. getDeployContext
  // above already resolved (and proved) the environment; if config cannot
  // be resolved here we are in a test with a mocked context, so skip.
  try {
    const resolved = resolveEnvironment({
      config: options.config,
      environmentName: options.environmentName,
    });
    ensureAllowWrite(resolved.root, resolved.envName, true, "deploy-project-delete");
  } catch (error) {
    if (!(error instanceof ScaiError) || error.code !== "CONFIG_NOT_FOUND") {
      throw error;
    }
  }
  const confirmed = await confirmDestructive(
    `Delete project '${selection}'? This cannot be undone.`,
    options.force
  );
  if (!confirmed) {
    logger.info("Delete cancelled.", "yellow");
    return;
  }
  const projectId = options.id ?? (await lookupProjectIdByNameOrId(context, selection));
  if (!projectId) {
    throw inputError("Project ID was not available.");
  }
  const result = await deleteProject(
    { accessToken: context.token, baseUrl: context.baseUrl },
    projectId
  );
  printDeployResultWithContext(logger, context, "deploy.projects.delete", result);
};

export const runDeployProjectsUpdate = async (
  options: DeployProjectUpdateOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const selection = options.id ?? options.name;
  if (!selection) {
    throw inputError("Project name or ID is required. Use --name or --id.");
  }
  if (options.whatIf && !options.id) {
    throw createScaiError("Project ID is required for --what-if. Use --id.", "INPUT_INVALID", {
      hint: "Provide an explicit project ID to avoid lookup calls.",
    });
  }
  const projectId = options.id ?? (await lookupProjectIdByNameOrId(context, selection));
  if (!projectId) {
    throw inputError("Project ID was not available.");
  }

  if (
    options.newName === undefined &&
    options.repositoryName === undefined &&
    options.repositoryId === undefined &&
    options.sourceControlIntegrationId === undefined
  ) {
    throw inputError(
      "Project update requires --new-name/--repository-name/--repository-id/--source-control-integration-id."
    );
  }
  const body: Record<string, unknown> = {};
  if (options.newName !== undefined) {
    body.name = options.newName;
  }
  if (options.repositoryName !== undefined) {
    body.repository = options.repositoryName;
  }
  if (options.repositoryId !== undefined) {
    body.repositoryId = options.repositoryId;
  }
  if (options.sourceControlIntegrationId !== undefined) {
    body.sourceControlIntegrationId = options.sourceControlIntegrationId;
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.projects.update", {
      method: "PUT",
      path: `/api/projects/v1/${projectId}`,
      body,
    });
    return;
  }

  const result = await updateProject(
    { accessToken: context.token, baseUrl: context.baseUrl },
    projectId,
    body
  );
  printDeployResultWithContext(logger, context, "deploy.projects.update", result);
};

export const runDeployProjectsLinkRepository = async (
  options: DeployProjectRepositoryLinkOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Project ID is required. Use --id.");
  }
  const body: Record<string, unknown> = {};
  if (options.repositoryName !== undefined) {
    body.repository = options.repositoryName;
  }
  if (options.repositoryId !== undefined) {
    body.repositoryId = options.repositoryId;
  }
  if (options.integrationId !== undefined) {
    body.integrationId = options.integrationId;
  }
  if (options.repositoryRelativePath !== undefined) {
    body.repositoryRelativePath = options.repositoryRelativePath;
  }

  const missing: string[] = [];
  if (!("repositoryId" in body)) {
    missing.push("repositoryId");
  }
  if (!("integrationId" in body)) {
    missing.push("integrationId");
  }
  if (missing.length > 0) {
    throw inputError(
      `Repository link requires: ${missing.join(", ")}. Use flags or --body/--body-file.`
    );
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.projects.repository.link", {
      method: "PUT",
      path: `/api/projects/v1/${options.id}/repository`,
      body,
    });
    return;
  }

  const result = await linkProjectRepository(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id,
    body
  );
  printDeployResultWithContext(logger, context, "deploy.projects.repository.link", result);
};

export const runDeployProjectsUnlinkRepository = async (
  options: DeployProjectOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const selection = options.id ?? options.name;
  if (!selection) {
    throw inputError("Project name or ID is required. Use --name or --id.");
  }
  if (options.whatIf && !options.id) {
    throw createScaiError("Project ID is required for --what-if. Use --id.", "INPUT_INVALID", {
      hint: "Provide an explicit project ID to avoid lookup calls.",
    });
  }
  const projectId = options.id ?? (await lookupProjectIdByNameOrId(context, selection));
  if (!projectId) {
    throw inputError("Project ID was not available.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.projects.repository.unlink", {
      method: "DELETE",
      path: `/api/projects/v1/${projectId}/repository`,
    });
    return;
  }
  const result = await unlinkProjectRepository(
    { accessToken: context.token, baseUrl: context.baseUrl },
    projectId
  );
  printDeployResultWithContext(logger, context, "deploy.projects.repository.unlink", result);
};
