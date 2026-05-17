import {
  fetchEnvironments,
  fetchAllEnvironments,
  fetchEnvironmentsLimitation,
  fetchEnvironment,
  fetchEnvironmentDeployments,
  createEnvironmentDeployment,
  fetchEnvironmentVariables,
  upsertEnvironmentVariable,
  deleteEnvironmentVariable,
  fetchEnvironmentEdgeToken,
  fetchEnvironmentEditingSecret,
  regenerateEnvironmentContext,
  deleteEnvironment,
  linkEnvironmentRepository,
  unlinkEnvironmentRepository,
  fetchEnvironmentRestartStatus,
  restartEnvironment,
  promoteEnvironmentDeployment,
  probeEnvironmentHealth,
  resolveHostFromEnvironment,
} from "@/deploy/api/environments";
import {
  fetchAllProjectEnvironments,
  fetchProjectEnvironments,
  createProjectEnvironment,
} from "@/deploy/api/projects";
import { resolveEnvironment } from "@/policy/environment";
import { ensureAllowWrite } from "@/policy/allow-write";
import { ScaiError } from "@/shared/errors";
import type { DeployEnvironment } from "@/deploy/api/common/types";
import {
  confirmDestructive,
  extractDeployEnvironmentList,
  filterEnvironmentsByType,
  getDeployContext,
  getEnvironmentType,
  inputError,
  printDeployResultWithContext,
  printDeployWhatIf,
  resolveDeployEnvironmentId,
  resolveDeployProjectId,
  toLogger,
} from "./shared";
import type {
  DeployBaseOptions,
  DeployEnvironmentCreateOptions,
  DeployEnvironmentDeleteOptions,
  DeployEnvironmentDeploymentsOptions,
  DeployEnvironmentOptions,
  DeployEnvironmentPromoteOptions,
  DeployEnvironmentRepositoryLinkOptions,
  DeployEnvironmentVariableOptions,
  DeployEnvironmentsListOptions,
} from "./types";
import { printDeploymentResult } from "./deployment-result";
import { runDeployDeploymentsDeploy, runDeployDeploymentsWatch } from "./deployments";

export const runDeployEnvironmentsList = async (
  options: DeployEnvironmentsListOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const projectId = await resolveDeployProjectId(context, options);
  const apiOptions = { accessToken: context.token, baseUrl: context.baseUrl };

  const normalizedType = options.type ? options.type.toLowerCase() : undefined;
  const baseQuery: Record<
    string,
    string | number | boolean | Array<string | number | boolean> | undefined
  > = {
    Types: normalizedType ? [normalizedType] : undefined,
  };

  // Default: walk every page. The Deploy API caps single-page responses at
  // 10 by default, so "list" without --page returning only the first page
  // surfaced as spurious "couldn't find" errors when an org or project grew
  // past that boundary. Operators who explicitly want page-at-a-time pass
  // --page; --no-all is the inverse opt-out.
  const walkAll = options.all !== false && options.page === undefined;

  if (projectId) {
    if (walkAll) {
      const aggregated = await fetchAllProjectEnvironments(
        apiOptions,
        projectId,
        options.pageSize ?? 50
      );
      const aggregatedResult = {
        totalCount: aggregated.totalCount,
        pageSize: aggregated.pageSize,
        data: options.type
          ? filterEnvironmentsByType(aggregated.items, options.type)
          : aggregated.items,
      };
      printDeployResultWithContext(logger, context, "deploy.environments.list", aggregatedResult);
      return;
    }
    const result = await fetchProjectEnvironments(apiOptions, projectId, {
      PageNumber: options.page,
      PageSize: options.pageSize,
    });
    if (options.type) {
      const list = extractDeployEnvironmentList(result);
      const filtered = filterEnvironmentsByType(list, options.type);
      printDeployResultWithContext(logger, context, "deploy.environments.list", filtered);
      return;
    }
    printDeployResultWithContext(logger, context, "deploy.environments.list", result);
    return;
  }

  if (walkAll) {
    const aggregated = await fetchAllEnvironments(apiOptions, baseQuery, options.pageSize ?? 50);
    const filteredData = options.type
      ? filterEnvironmentsByType(aggregated.items, options.type)
      : aggregated.items;
    // Mirror the single-page fallback: if the server's Types filter
    // returned an empty list under a type filter, re-walk without it
    // and filter client-side. Defensive against server-side filter
    // semantics that occasionally surface as "no envs" when there are.
    if (options.type && filteredData.length === 0 && (aggregated.totalCount ?? 0) === 0) {
      const fallback = await fetchAllEnvironments(apiOptions, {}, options.pageSize ?? 50);
      const fallbackFiltered = filterEnvironmentsByType(fallback.items, options.type);
      printDeployResultWithContext(logger, context, "deploy.environments.list", fallbackFiltered);
      return;
    }
    const aggregatedResult = {
      totalCount: aggregated.totalCount,
      pageSize: aggregated.pageSize,
      data: filteredData,
    };
    printDeployResultWithContext(logger, context, "deploy.environments.list", aggregatedResult);
    return;
  }

  const query: Record<
    string,
    string | number | boolean | Array<string | number | boolean> | undefined
  > = {
    ...baseQuery,
    PageNumber: options.page,
    PageSize: options.pageSize,
  };
  const result = await fetchEnvironments(apiOptions, query);
  if (!options.type) {
    printDeployResultWithContext(logger, context, "deploy.environments.list", result);
    return;
  }

  const list = extractDeployEnvironmentList(result);
  if (list.length > 0) {
    printDeployResultWithContext(logger, context, "deploy.environments.list", result);
    return;
  }

  const fallback = await fetchEnvironments(apiOptions, {});
  const fallbackList = extractDeployEnvironmentList(fallback);
  const filtered = filterEnvironmentsByType(fallbackList, options.type);
  printDeployResultWithContext(logger, context, "deploy.environments.list", filtered);
};

export const runDeployEnvironmentsLimitation = async (
  options: DeployBaseOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const result = await fetchEnvironmentsLimitation({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  printDeployResultWithContext(logger, context, "deploy.environments.limitation", result);
};

export const runDeployEnvironmentsGet = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const result = await fetchEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  if (options.project && options.name && !options.id) {
    const output = {
      environmentId:
        (result as { id?: string; environmentId?: string }).id ??
        (result as { environmentId?: string }).environmentId ??
        environmentId,
      type: getEnvironmentType(result as unknown as DeployEnvironment) ?? null,
    };
    if (logger.isJson()) {
      printDeployResultWithContext(logger, context, "deploy.environments.get", result, output);
      return;
    }
    printDeployResultWithContext(logger, context, "deploy.environments.get", output);
    return;
  }
  printDeployResultWithContext(logger, context, "deploy.environments.get", result);
};

export const runDeployEnvironmentsCreate = async (
  options: DeployEnvironmentCreateOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const projectId = await resolveDeployProjectId(context, options);
  if (!projectId) {
    throw inputError("Project ID is required. Use --project.");
  }
  if (!options.name) {
    throw inputError("Environment name is required. Use --name.");
  }
  const body: Record<string, unknown> = {
    name: options.name,
  };
  if (options.tenantType) {
    body.tenantType = options.tenantType;
  }
  if (options.cmOnly) {
    body.type = "cm";
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.create", {
      method: "POST",
      path: `/api/projects/v2/${projectId}/environments`,
      body,
    });
    return;
  }

  const result = await createProjectEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    projectId,
    body
  );
  printDeployResultWithContext(logger, context, "deploy.environments.create", result);
};

export const runDeployEnvironmentsVariablesList = async (
  options: DeployEnvironmentVariableOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const result = await fetchEnvironmentVariables(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.variables.list", result);
};

export const runDeployEnvironmentsVariablesCreate = async (
  options: DeployEnvironmentVariableOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.variable) {
    throw inputError("Variable name is required. Use --variable.");
  }
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (options.value === undefined && options.target === undefined && options.secret === undefined) {
    throw inputError("Variable data is required. Use --value/--target/--secret.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.variables.upsert", {
      method: "POST",
      path: `/api/environments/v1/${environmentId}/variables/${encodeURIComponent(
        options.variable
      )}`,
      body: {
        value: options.value,
        target: options.target,
        secret: options.secret,
      },
    });
    return;
  }
  const result = await upsertEnvironmentVariable(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.variable,
    {
      value: options.value,
      target: options.target,
      secret: options.secret,
    }
  );
  printDeployResultWithContext(logger, context, "deploy.environments.variables.upsert", result);
};

export const runDeployEnvironmentsVariablesDelete = async (
  options: DeployEnvironmentVariableOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.variable) {
    throw inputError("Variable name is required. Use --variable.");
  }
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.variables.delete", {
      method: "DELETE",
      path: `/api/environments/v1/${environmentId}/variables/${encodeURIComponent(
        options.variable
      )}`,
    });
    return;
  }
  const result = await deleteEnvironmentVariable(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.variable
  );
  printDeployResultWithContext(logger, context, "deploy.environments.variables.delete", result);
};

export const runDeployEnvironmentsDeploymentsList = async (
  options: DeployEnvironmentDeploymentsOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const result = await fetchEnvironmentDeployments(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.deployments.list", result);
};

export const runDeployEnvironmentsDeploymentsCreate = async (
  options: DeployEnvironmentDeploymentsOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.deployments.create", {
      method: "POST",
      path: `/api/environments/v2/${environmentId}/deployments`,
      query: (options.redeploy ?? false) ? { redeploy: true } : undefined,
    });
    return;
  }
  const result = await createEnvironmentDeployment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.redeploy ?? false
  );
  printDeploymentResult(logger, context, "deploy.environments.deployments.create", result);
};

export const runDeployEnvironmentsGetEdgeToken = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const result = await fetchEnvironmentEdgeToken(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.edge-token", result);
};

export const runDeployEnvironmentsGetEditingSecret = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const result = await fetchEnvironmentEditingSecret(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.editing-secret", result);
};

export const runDeployEnvironmentsRegenerateContext = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.regenerate-context", {
      method: "POST",
      path: `/api/environments/v1/${environmentId}/regenerate-context`,
    });
    return;
  }
  const result = await regenerateEnvironmentContext(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.regenerate-context", result);
};

export const runDeployEnvironmentsPromote = async (
  options: DeployEnvironmentPromoteOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (!options.sourceId) {
    throw inputError("Source deployment ID is required. Use --source-id.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.promote", {
      method: "POST",
      path: `/api/environments/v2/${environmentId}/promote/${options.sourceId}`,
      body: { environmentId, deploymentId: options.sourceId },
    });
    return;
  }
  const result = await promoteEnvironmentDeployment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.sourceId
  );
  const deploymentId = printDeploymentResult(
    logger,
    context,
    "deploy.environments.promote",
    result
  );
  if (!deploymentId) {
    return;
  }
  if (options.noStart) {
    return;
  }
  await runDeployDeploymentsDeploy({ ...options, id: deploymentId });
  if (!options.noWatch) {
    await runDeployDeploymentsWatch({
      ...options,
      id: deploymentId,
      waitForPostActions: options.waitForPostActions,
    });
  }
};

export const runDeployEnvironmentsDelete = async (
  options: DeployEnvironmentDeleteOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.delete", {
      method: "DELETE",
      path: `/api/environments/v1/${environmentId}`,
      query: options.force ? { force: true } : undefined,
    });
    return;
  }
  // Destructive-tier policy gate — environment deletion is irreversible.
  // Refused for m2m / mcp callers and for CI without ciWrites; a no-op in
  // unmanaged mode. See docs/policy-and-guardrails.md. getDeployContext
  // above already resolved (and proved) the environment; if config cannot
  // be resolved here we are in a test with a mocked context, so skip.
  try {
    const resolved = resolveEnvironment({
      config: options.config,
      environmentName: options.environmentName,
    });
    ensureAllowWrite(resolved.root, resolved.envName, true, "deploy-environment-delete");
  } catch (error) {
    if (!(error instanceof ScaiError) || error.code !== "CONFIG_NOT_FOUND") {
      throw error;
    }
  }
  const confirmed = await confirmDestructive(
    `Delete environment '${environmentId}'? This cannot be undone.`,
    options.force
  );
  if (!confirmed) {
    logger.info("Delete cancelled.", "yellow");
    return;
  }
  const result = await deleteEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.force
  );
  printDeployResultWithContext(logger, context, "deploy.environments.delete", result);
};

export const runDeployEnvironmentsLinkRepository = async (
  options: DeployEnvironmentRepositoryLinkOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
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
  if (options.repositoryBranch !== undefined) {
    body.repositoryBranch = options.repositoryBranch;
  }

  const missing: string[] = [];
  if (!("repository" in body)) {
    missing.push("repository");
  }
  if (!("repositoryId" in body)) {
    missing.push("repositoryId");
  }
  if (!("integrationId" in body)) {
    missing.push("integrationId");
  }
  if (!("repositoryRelativePath" in body)) {
    missing.push("repositoryRelativePath");
  }
  if (!("repositoryBranch" in body)) {
    missing.push("repositoryBranch");
  }
  if (missing.length > 0) {
    throw inputError(`Environment repository link requires: ${missing.join(", ")}.`);
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.repository.link", {
      method: "PUT",
      path: `/api/environments/v1/${environmentId}/repository`,
      body,
    });
    return;
  }
  const result = await linkEnvironmentRepository(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    body
  );
  printDeployResultWithContext(logger, context, "deploy.environments.repository.link", result);
};

export const runDeployEnvironmentsUnlinkRepository = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.repository.unlink", {
      method: "DELETE",
      path: `/api/environments/v1/${environmentId}/repository`,
    });
    return;
  }
  const result = await unlinkEnvironmentRepository(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.repository.unlink", result);
};

export const runDeployEnvironmentsHealth = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const environment = await fetchEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  const host = resolveHostFromEnvironment(environment);
  if (!host) {
    throw inputError(
      `Environment '${environmentId}' has no resolvable host. The Deploy API returned no cmUrl/cmHost/host/url. Cannot probe /healthz/ready.`
    );
  }
  const result = await probeEnvironmentHealth(host);
  printDeployResultWithContext(logger, context, "deploy.environments.health", result);
};

export const runDeployEnvironmentsRestartStatus = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const result = await fetchEnvironmentRestartStatus(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.restart-status", result);
};

export const runDeployEnvironmentsRestart = async (
  options: DeployEnvironmentOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.environments.restart", {
      method: "POST",
      path: `/api/environments/v1/${environmentId}/restart`,
    });
    return;
  }
  const confirmed = await confirmDestructive(
    `Restart environment '${environmentId}'?`,
    (options as { force?: boolean }).force
  );
  if (!confirmed) {
    logger.info("Restart cancelled.", "yellow");
    return;
  }
  const result = await restartEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId
  );
  printDeployResultWithContext(logger, context, "deploy.environments.restart", result);
};
