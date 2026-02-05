import {
  fetchEnvironment,
  fetchOrganization,
  fetchProjectEnvironments,
  fetchProjects,
  resolveHostFromEnvironment,
  DeployEnvironment,
} from "@/deploy/api";
import type { EnvironmentConfiguration } from "@/config";
import type { ConnectOptions } from "../../types";
import {
  getEnvironmentType,
  inputError,
  resolveProjectIdValue,
  selectFromList,
  selectMatch,
} from "../../shared";
import type { Logger } from "@/shared/logger";
import { promptText } from "@/shared/prompt";
import { createCliError } from "@/shared/errors";

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
    if (!projectSelection && runWizard && projects.length > 1) {
      resolvedProject = await selectFromList(logger, "Project", projects);
    } else {
      resolvedProject = selectMatch(projects, "Project", projectSelection);
    }
    const environments = await fetchProjectEnvironments(
      deployOptions,
      resolvedProject.id ?? resolvedProject.projectId ?? ""
    );
    const cmEnvironments = environments.filter((environment) => {
      const type = getEnvironmentType(environment);
      return type ? type.toLowerCase().includes("cm") : false;
    });
    const selectionPool =
      !environmentSelection && cmEnvironments.length > 0 ? cmEnvironments : environments;
    const environmentLabel =
      !environmentSelection && cmEnvironments.length > 0 ? "Environment (CM)" : "Environment";
    if (!environmentSelection && runWizard && selectionPool.length > 1) {
      resolvedEnvironment = await selectFromList(logger, environmentLabel, selectionPool);
    } else {
      resolvedEnvironment = selectMatch(
        selectionPool,
        "Environment",
        environmentSelection
      ) as DeployEnvironment;
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
    logger.warn("Deploy lookup failed. Environment-scoped credentials require an environment ID.");
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
