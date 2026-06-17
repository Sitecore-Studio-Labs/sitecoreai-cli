import {
  fetchEnvironment,
  fetchOrganization,
  fetchProject,
  fetchProjectEnvironments,
  fetchProjects,
  createProjectEnvironment,
  resolveHostFromEnvironment,
  DeployEnvironment,
} from "@/deploy/api";
import type { EnvironmentConfiguration } from "@/config/types";
import type { ConnectOptions } from "../../types";
import { inputError, selectFromList, selectMatch } from "@/shared/cli-tasks";
import {
  getEnvironmentType,
  resolveProjectIdValue,
  resolveTenantTypeValue,
} from "@/deploy/tasks/shared";
import type { Logger } from "@/shared/logger";
import { promptConfirm, promptText } from "@/shared/prompt";
import { createScaiError, toScaiError } from "@/shared/errors";

type ResolveDeployLookupInput = {
  options: ConnectOptions;
  runWizard: boolean;
  deployToken?: string;
  updated: EnvironmentConfiguration;
  existing: EnvironmentConfiguration;
  baseEnv: EnvironmentConfiguration;
  host?: string;
  projectSelection?: string;
  environmentSelection?: string;
  logger: Logger;
};

type ResolveDeployLookupResult = {
  host?: string;
  updated: EnvironmentConfiguration;
};

const hasProjectRepository = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record.repositoryId,
    record.repositoryName,
    record.repositoryRelativePath,
    record.repositoryUrl,
    record.sourceControlIntegrationId,
    record.sourceControlIntegration,
    record.repository,
    record.repo,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return true;
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedCandidates = [
        nested.id,
        nested.name,
        nested.repositoryId,
        nested.repositoryName,
        nested.url,
      ];
      if (nestedCandidates.some((entry) => typeof entry === "string" && entry.trim().length > 0)) {
        return true;
      }
    }
  }
  return false;
};

/** Prompt for a valid tenant type, re-prompting until prod/nonprod is entered. */
const promptTenantType = async (logger: Logger): Promise<number> => {
  for (;;) {
    const tenantInput = await promptText("Tenant type (prod/nonprod)", "nonprod");
    const resolvedTenantType = resolveTenantTypeValue(tenantInput);
    if (resolvedTenantType !== undefined) {
      return resolvedTenantType;
    }
    logger.warn("Invalid tenant type. Use 'prod' or 'nonprod'.");
  }
};

/**
 * Resolve an environment ID from config precedence, falling back to an
 * interactive prompt. Throws when none can be determined.
 */
const resolveEnvironmentId = async (params: {
  updated: EnvironmentConfiguration;
  existing: EnvironmentConfiguration;
  baseEnv: EnvironmentConfiguration;
  options: ConnectOptions;
  errorMessage: string;
}): Promise<string> => {
  const { updated, existing, baseEnv, options, errorMessage } = params;
  let environmentId =
    updated.environmentId ?? existing.environmentId ?? baseEnv.environmentId ?? options.environment;
  if (!environmentId) {
    environmentId = await promptText("Environment ID (Deploy)");
  }
  if (!environmentId) {
    throw inputError(errorMessage);
  }
  return environmentId;
};

/** Build the create-environment request body from interactive prompts. */
const buildCreateEnvironmentBody = async (logger: Logger): Promise<Record<string, unknown>> => {
  const name = await promptText("Environment name");
  if (!name) {
    throw inputError("Environment name is required. Use --name.");
  }
  const cmOnly = await promptConfirm("Create a CM-only environment?", true);
  const tenantType = await promptTenantType(logger);
  const body: Record<string, unknown> = { name };
  if (tenantType !== undefined) {
    body.tenantType = tenantType;
  }
  body.type = cmOnly ? "cm" : "combined";
  return body;
};

/** Filter an environment list to those whose type contains the given marker. */
const filterEnvironmentsByType = (
  environments: DeployEnvironment[],
  marker: string
): DeployEnvironment[] =>
  environments.filter((environment) => {
    const type = getEnvironmentType(environment);
    return type ? type.toLowerCase().includes(marker) : false;
  });

/**
 * Pick the target environment from the candidate pool: list-select in the
 * wizard, auto-select (announcing it) when only one candidate exists, else
 * match by the provided selection value.
 */
const selectEnvironment = async (params: {
  environmentSelection?: string;
  runWizard: boolean;
  selectionPool: DeployEnvironment[];
  environmentLabel: string;
  cmEnvironments: DeployEnvironment[];
  resolvedProjectLabel: string;
  logger: Logger;
}): Promise<DeployEnvironment> => {
  const {
    environmentSelection,
    runWizard,
    selectionPool,
    environmentLabel,
    cmEnvironments,
    resolvedProjectLabel,
    logger,
  } = params;
  if (!environmentSelection && runWizard && selectionPool.length > 1) {
    return selectFromList(logger, environmentLabel, selectionPool);
  }
  if (!environmentSelection && runWizard && selectionPool.length === 1) {
    // Only one candidate. Auto-select it, but announce it by name —
    // silently locking onto an environment the user never saw reads
    // as "the project step just exited without asking anything".
    const only = selectionPool[0];
    const autoName = only.name ?? only.id ?? only.environmentId ?? "(unknown)";
    const autoId = only.id ?? only.environmentId ?? "-";
    const poolKind = cmEnvironments.length > 0 ? "CM environment" : "environment";
    logger.info(
      `Using the only ${poolKind} in '${resolvedProjectLabel}': ${autoName} (${autoId})`,
      "cyan"
    );
    return only;
  }
  return selectMatch(selectionPool, "Environment", environmentSelection) as DeployEnvironment;
};

/** Apply the environment-type field to `updated` when it is a recognized CM/EH type. */
const applyEnvironmentType = (
  updated: EnvironmentConfiguration,
  environment: DeployEnvironment
): void => {
  const resolvedType = getEnvironmentType(environment);
  if (resolvedType === "cm" || resolvedType === "eh") {
    updated.environmentType = resolvedType;
  }
};

/**
 * Recover from a failed (or unavailable) deploy lookup by resolving the
 * environment directly from its ID — the path taken for environment-scoped
 * credentials, which can't enumerate orgs/projects.
 */
const recoverFromEnvironmentScoped = async (params: {
  error: unknown;
  deployOptions: { accessToken: string };
  updated: EnvironmentConfiguration;
  existing: EnvironmentConfiguration;
  baseEnv: EnvironmentConfiguration;
  options: ConnectOptions;
  nextHost?: string;
  logger: Logger;
}): Promise<string | undefined> => {
  const { error, deployOptions, updated, existing, baseEnv, options, nextHost, logger } = params;
  const cliError = toScaiError(error);
  const isEnvScoped = /environment[- ]scoped/i.test(cliError.message);
  const warning = isEnvScoped
    ? "Deploy lookup failed. Environment-scoped credentials require an environment ID."
    : `Deploy lookup failed. ${cliError.message}`;
  logger.warn(warning);
  const environmentId = await resolveEnvironmentId({
    updated,
    existing,
    baseEnv,
    options,
    errorMessage:
      "Environment ID is required for environment-scoped credentials. Use --environment <id>.",
  });
  const resolvedEnvironment = await fetchEnvironment(deployOptions, environmentId);
  logger.warn(
    "Environment-scoped credentials can limit some CLI operations (org/project lookups)."
  );
  updated.environmentId =
    resolvedEnvironment.id ?? resolvedEnvironment.environmentId ?? updated.environmentId;
  updated.projectId = resolveProjectIdValue(resolvedEnvironment.projectId) ?? updated.projectId;
  updated.tenantId = resolvedEnvironment.tenantId ?? updated.tenantId;
  applyEnvironmentType(updated, resolvedEnvironment);
  return nextHost ?? resolveHostFromEnvironment(resolvedEnvironment);
};

type ProjectResolution = {
  resolvedProject: { id?: string; projectId?: string; name?: string };
  environments: DeployEnvironment[];
  resolvedEnvironment?: DeployEnvironment;
};

/**
 * Drive the interactive project-selection loop: pick a project, fetch its
 * environments, and — when a project has none — either recover via a direct
 * environment ID (no repository), create a fresh environment, or re-prompt
 * for a different project. Returns once a usable project/environment is found.
 */
const resolveProjectAndEnvironments = async (params: {
  projects: { id?: string; projectId?: string; name?: string }[];
  projectSelection?: string;
  runWizard: boolean;
  deployOptions: { accessToken: string };
  updated: EnvironmentConfiguration;
  existing: EnvironmentConfiguration;
  baseEnv: EnvironmentConfiguration;
  options: ConnectOptions;
  logger: Logger;
}): Promise<ProjectResolution> => {
  const {
    projects,
    projectSelection,
    runWizard,
    deployOptions,
    updated,
    existing,
    baseEnv,
    options,
    logger,
  } = params;
  let selectedProjectValue = projectSelection;
  let projectDetails: unknown | undefined;
  for (;;) {
    const resolvedProject =
      !selectedProjectValue && runWizard && projects.length > 1
        ? await selectFromList(logger, "Project", projects)
        : selectMatch(projects, "Project", selectedProjectValue);
    const resolvedProjectId = resolvedProject.id ?? resolvedProject.projectId ?? "";
    const resolvedProjectLabel =
      resolvedProject.name ?? resolvedProject.id ?? resolvedProject.projectId ?? "selected project";
    const environments = await fetchProjectEnvironments(deployOptions, resolvedProjectId);
    if (environments.length > 0) {
      return { resolvedProject, environments };
    }
    if (!runWizard) {
      throw inputError(`No environments were returned for project '${resolvedProjectLabel}'.`);
    }
    if (!projectDetails) {
      try {
        projectDetails = await fetchProject(deployOptions, resolvedProjectId);
      } catch (error) {
        logger.warn(`Unable to verify repository linkage. ${toScaiError(error).message}`);
      }
    }
    if (!hasProjectRepository(projectDetails ?? resolvedProject)) {
      logger.warn(
        `Project '${resolvedProjectLabel}' is not linked to a repository. Environment creation requires a repository.`
      );
      if (projects.length > 1 && (await promptConfirm("Select a different project?", true))) {
        selectedProjectValue = undefined;
        projectDetails = undefined;
        continue;
      }
      const environmentId = await resolveEnvironmentId({
        updated,
        existing,
        baseEnv,
        options,
        errorMessage: "Environment ID is required. Use --environment <id>.",
      });
      const resolvedEnvironment = await fetchEnvironment(deployOptions, environmentId);
      const projectIdFromEnvironment = resolveProjectIdValue(resolvedEnvironment.projectId);
      const nextProject = projectIdFromEnvironment
        ? { ...resolvedProject, id: projectIdFromEnvironment, projectId: projectIdFromEnvironment }
        : resolvedProject;
      return { resolvedProject: nextProject, environments, resolvedEnvironment };
    }

    const shouldCreate = await promptConfirm(
      `No environments found for project '${resolvedProjectLabel}'. Create one now?`,
      false
    );
    if (shouldCreate) {
      const body = await buildCreateEnvironmentBody(logger);
      let created: DeployEnvironment;
      try {
        created = (await createProjectEnvironment(
          deployOptions,
          resolvedProjectId,
          body
        )) as DeployEnvironment;
      } catch (error) {
        logger.warn(`Environment creation failed. ${toScaiError(error).message}`);
        if (projects.length > 1 && (await promptConfirm("Select a different project?", true))) {
          selectedProjectValue = undefined;
          projectDetails = undefined;
          continue;
        }
        throw error;
      }
      const refreshed = await fetchProjectEnvironments(deployOptions, resolvedProjectId);
      return { resolvedProject, environments: refreshed, resolvedEnvironment: created };
    }
    if (projects.length <= 1) {
      throw inputError(`No environments were returned for project '${resolvedProjectLabel}'.`);
    }
    selectedProjectValue = undefined;
  }
};

export const resolveDeployLookup = async (
  input: ResolveDeployLookupInput
): Promise<ResolveDeployLookupResult> => {
  const {
    options,
    runWizard,
    deployToken,
    updated,
    existing,
    baseEnv,
    host,
    projectSelection,
    environmentSelection,
    logger,
  } = input;
  if (!deployToken) {
    throw createScaiError(
      "Deploy API access token is required. Provide --deploy-token or deploy credentials.",
      "AUTH_REQUIRED",
      {
        hint: "Provide --deploy-token, or run 'scai setup login' to store credentials.",
      }
    );
  }

  const deployOptions = { accessToken: deployToken };
  let resolvedEnvironment: DeployEnvironment | undefined;
  let nextHost = host;

  try {
    const organization = await fetchOrganization(deployOptions);
    const orgId = organization.id ?? organization.organizationId ?? options.organizationId;

    const projects = await fetchProjects(deployOptions);
    const projectResolution = await resolveProjectAndEnvironments({
      projects,
      projectSelection,
      runWizard,
      deployOptions,
      updated,
      existing,
      baseEnv,
      options,
      logger,
    });
    const resolvedProject = projectResolution.resolvedProject;
    const environments = projectResolution.environments;
    const resolvedProjectLabel =
      resolvedProject.name ?? resolvedProject.id ?? resolvedProject.projectId ?? "selected project";
    if (projectResolution.resolvedEnvironment) {
      resolvedEnvironment = projectResolution.resolvedEnvironment;
    }

    const cmEnvironments = filterEnvironmentsByType(environments, "cm");
    const selectionPool =
      !environmentSelection && cmEnvironments.length > 0 ? cmEnvironments : environments;
    const environmentLabel =
      !environmentSelection && cmEnvironments.length > 0 ? "Environment (CM)" : "Environment";
    if (!resolvedEnvironment) {
      resolvedEnvironment = await selectEnvironment({
        environmentSelection,
        runWizard,
        selectionPool,
        environmentLabel,
        cmEnvironments,
        resolvedProjectLabel,
        logger,
      });
    }
    const editingHostEnvironmentIds = filterEnvironmentsByType(environments, "eh")
      .map((environment) => environment.id ?? environment.environmentId)
      .filter((value): value is string => Boolean(value));

    updated.organizationId = orgId ?? updated.organizationId;
    updated.projectId = resolvedProject.id ?? resolvedProject.projectId ?? updated.projectId;
    updated.environmentId =
      resolvedEnvironment.id ?? resolvedEnvironment.environmentId ?? updated.environmentId;
    updated.tenantId = resolvedEnvironment.tenantId ?? updated.tenantId ?? organization.tenantId;
    applyEnvironmentType(updated, resolvedEnvironment);
    if (editingHostEnvironmentIds.length > 0) {
      updated.editingHostEnvironmentIds = editingHostEnvironmentIds;
    }

    if (!nextHost) {
      nextHost = resolveHostFromEnvironment(resolvedEnvironment);
    }
  } catch (error) {
    if (!runWizard) {
      throw error;
    }
    nextHost = await recoverFromEnvironmentScoped({
      error,
      deployOptions,
      updated,
      existing,
      baseEnv,
      options,
      nextHost,
      logger,
    });
  }

  return { host: nextHost, updated };
};
