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
import type { EnvironmentConfiguration } from "@/config";
import type { ConnectOptions } from "../../types";
import { inputError, selectFromList, selectMatch } from "@/shared/cli-tasks";
import {
  getEnvironmentType,
  resolveProjectIdValue,
  resolveTenantTypeValue,
} from "@/deploy/tasks/shared";
import type { Logger } from "@/shared/logger";
import { promptConfirm, promptText } from "@/shared/prompt";
import { createCliError, toCliError } from "@/shared/errors";

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
    throw createCliError(
      "Deploy API access token is required. Provide --deploy-token or deploy credentials.",
      "AUTH_REQUIRED",
      {
        hint: "Provide --deploy-token, or run 'scai login' to store credentials.",
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
    let resolvedProject;
    let environments: DeployEnvironment[] = [];
    let resolvedProjectId = "";
    let resolvedProjectLabel = "selected project";
    let projectDetails: unknown | undefined;

    let selectedProjectValue = projectSelection;
    while (true) {
      if (!selectedProjectValue && runWizard && projects.length > 1) {
        resolvedProject = await selectFromList(logger, "Project", projects);
      } else {
        resolvedProject = selectMatch(projects, "Project", selectedProjectValue);
      }
      resolvedProjectId = resolvedProject.id ?? resolvedProject.projectId ?? "";
      resolvedProjectLabel =
        resolvedProject.name ??
        resolvedProject.id ??
        resolvedProject.projectId ??
        "selected project";
      environments = await fetchProjectEnvironments(deployOptions, resolvedProjectId);
      if (environments.length > 0) {
        break;
      }
      if (!runWizard) {
        throw inputError(`No environments were returned for project '${resolvedProjectLabel}'.`);
      }
      if (!projectDetails) {
        try {
          projectDetails = await fetchProject(deployOptions, resolvedProjectId);
        } catch (error) {
          const cliError = toCliError(error);
          logger.warn(`Unable to verify repository linkage. ${cliError.message}`);
        }
      }
      if (!hasProjectRepository(projectDetails ?? resolvedProject)) {
        logger.warn(
          `Project '${resolvedProjectLabel}' is not linked to a repository. Environment creation requires a repository.`
        );
        if (projects.length > 1) {
          const chooseAnother = await promptConfirm("Select a different project?", true);
          if (chooseAnother) {
            selectedProjectValue = undefined;
            projectDetails = undefined;
            continue;
          }
        }
        let environmentId =
          updated.environmentId ??
          existing.environmentId ??
          baseEnv.environmentId ??
          options.environment;
        if (!environmentId) {
          environmentId = await promptText("Environment ID (Deploy)");
        }
        if (!environmentId) {
          throw inputError("Environment ID is required. Use --environment <id>.");
        }
        resolvedEnvironment = await fetchEnvironment(deployOptions, environmentId);
        const projectIdFromEnvironment = resolveProjectIdValue(resolvedEnvironment.projectId);
        if (projectIdFromEnvironment) {
          resolvedProject = {
            ...(resolvedProject ?? {}),
            id: projectIdFromEnvironment,
            projectId: projectIdFromEnvironment,
          };
        }
        break;
      }

      const shouldCreate = await promptConfirm(
        `No environments found for project '${resolvedProjectLabel}'. Create one now?`,
        false
      );
      if (shouldCreate) {
        const name = await promptText("Environment name");
        if (!name) {
          throw inputError("Environment name is required. Use --name.");
        }
        const cmOnly = await promptConfirm("Create a CM-only environment?", true);
        let tenantType: number | undefined;
        while (tenantType === undefined) {
          const tenantInput = await promptText("Tenant type (prod/nonprod)", "nonprod");
          const resolvedTenantType = resolveTenantTypeValue(tenantInput);
          if (resolvedTenantType !== undefined) {
            tenantType = resolvedTenantType;
            break;
          }
          logger.warn("Invalid tenant type. Use 'prod' or 'nonprod'.");
        }
        const body: Record<string, unknown> = { name };
        if (tenantType !== undefined) {
          body.tenantType = tenantType;
        }
        body.type = cmOnly ? "cm" : "combined";
        try {
          const created = (await createProjectEnvironment(
            deployOptions,
            resolvedProjectId,
            body
          )) as DeployEnvironment;
          resolvedEnvironment = created;
          environments = await fetchProjectEnvironments(deployOptions, resolvedProjectId);
          break;
        } catch (error) {
          const cliError = toCliError(error);
          logger.warn(`Environment creation failed. ${cliError.message}`);
          if (projects.length > 1) {
            const chooseAnother = await promptConfirm("Select a different project?", true);
            if (chooseAnother) {
              selectedProjectValue = undefined;
              projectDetails = undefined;
              continue;
            }
          }
          throw error;
        }
      }
      if (projects.length <= 1) {
        throw inputError(`No environments were returned for project '${resolvedProjectLabel}'.`);
      }
      selectedProjectValue = undefined;
    }
    const cmEnvironments = environments.filter((environment) => {
      const type = getEnvironmentType(environment);
      return type ? type.toLowerCase().includes("cm") : false;
    });
    const selectionPool =
      !environmentSelection && cmEnvironments.length > 0 ? cmEnvironments : environments;
    const environmentLabel =
      !environmentSelection && cmEnvironments.length > 0 ? "Environment (CM)" : "Environment";
    if (!resolvedEnvironment) {
      if (!environmentSelection && runWizard && selectionPool.length > 1) {
        resolvedEnvironment = await selectFromList(logger, environmentLabel, selectionPool);
      } else {
        resolvedEnvironment = selectMatch(
          selectionPool,
          "Environment",
          environmentSelection
        ) as DeployEnvironment;
      }
    }
    const editingHostEnvironmentIds = environments
      .filter((environment) => {
        const type = getEnvironmentType(environment);
        return type ? type.toLowerCase().includes("eh") : false;
      })
      .map((environment) => environment.id ?? environment.environmentId)
      .filter((value): value is string => Boolean(value));

    updated.organizationId = orgId ?? updated.organizationId;
    updated.projectId = resolvedProject.id ?? resolvedProject.projectId ?? updated.projectId;
    updated.environmentId =
      resolvedEnvironment.id ?? resolvedEnvironment.environmentId ?? updated.environmentId;
    updated.tenantId = resolvedEnvironment.tenantId ?? updated.tenantId ?? organization.tenantId;
    const resolvedType = getEnvironmentType(resolvedEnvironment);
    if (resolvedType === "cm" || resolvedType === "eh") {
      updated.environmentType = resolvedType;
    }
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
    const cliError = toCliError(error);
    const isEnvScoped = /environment[- ]scoped/i.test(cliError.message);
    const warning = isEnvScoped
      ? "Deploy lookup failed. Environment-scoped credentials require an environment ID."
      : `Deploy lookup failed. ${cliError.message}`;
    logger.warn(warning);
    let environmentId =
      updated.environmentId ??
      existing.environmentId ??
      baseEnv.environmentId ??
      options.environment;
    if (!environmentId) {
      environmentId = await promptText("Environment ID (Deploy)");
    }
    if (!environmentId) {
      throw inputError(
        "Environment ID is required for environment-scoped credentials. Use --environment <id>."
      );
    }
    resolvedEnvironment = await fetchEnvironment(deployOptions, environmentId);
    logger.warn(
      "Environment-scoped credentials can limit some CLI operations (org/project lookups)."
    );
    updated.environmentId =
      resolvedEnvironment.id ?? resolvedEnvironment.environmentId ?? updated.environmentId;
    updated.projectId = resolveProjectIdValue(resolvedEnvironment.projectId) ?? updated.projectId;
    updated.tenantId = resolvedEnvironment.tenantId ?? updated.tenantId;
    const resolvedType = getEnvironmentType(resolvedEnvironment);
    if (resolvedType === "cm" || resolvedType === "eh") {
      updated.environmentType = resolvedType;
    }
    if (!nextHost) {
      nextHost = resolveHostFromEnvironment(resolvedEnvironment);
    }
  }

  return { host: nextHost, updated };
};
