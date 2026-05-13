/**
 * Helpers specific to `scai deploy` task runners — env-context
 * resolution against the Deploy API, JSON-aware result printing,
 * project/environment/org lookup. Neutral helpers (`toLogger`,
 * `selectMatch`, `confirmDestructive`, etc.) live in
 * `@/shared/cli-tasks`; serialization-specific helpers live in
 * `@/serialization/tasks/shared`.
 */

import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { getDeployToken } from "@/shared/keychain";
import { inputError, selectMatch } from "@/shared/cli-tasks";
import { resolveEnvironment } from "@/shared/env";
import {
  fetchOrganization,
  fetchProjects,
  fetchProjectEnvironments,
  fetchEnvironments,
  DeployEnvironment,
} from "@/deploy/api";

// Re-export neutral helpers so deploy task runners can keep using
// the local `./shared` import surface; new code can also import
// these directly from `@/shared/cli-tasks`.
export {
  toLogger,
  applyIfDefined,
  inputError,
  confirmDestructive,
  selectMatch,
  selectFromList,
  resolveApiTimeoutMs,
} from "@/shared/cli-tasks";

export const getDeployContext = async (options: {
  config?: string;
  environmentName?: string;
  whatIf?: boolean;
}): Promise<{
  token: string;
  baseUrl?: string;
  envName: string;
  organizationId?: string;
  projectId?: string;
  environmentId?: string;
  environmentType?: string;
  editingHostEnvironmentIds?: string[];
  whatIf?: boolean;
}> => {
  const { envName, environment } = resolveEnvironment(options);
  const token = (await getDeployToken(envName)) ?? environment.deployToken;
  if (!token) {
    throw createScaiError(`Deploy token not found for environment '${envName}'.`, "AUTH_REQUIRED", {
      hint: "Run 'scai init' or 'scai login' to authenticate.",
    });
  }
  return {
    token,
    baseUrl: undefined,
    envName,
    organizationId: environment.organizationId,
    projectId: environment.projectId,
    environmentId: environment.environmentId,
    environmentType: environment.environmentType,
    editingHostEnvironmentIds: environment.editingHostEnvironmentIds,
    whatIf: options.whatIf,
  };
};

export const resolveDeployOrganizationId = async (context: {
  token: string;
  baseUrl?: string;
  organizationId?: string;
}): Promise<string | undefined> => {
  if (context.organizationId) {
    return context.organizationId;
  }
  try {
    const organization = await fetchOrganization({
      accessToken: context.token,
      baseUrl: context.baseUrl,
    });
    return organization.id ?? organization.organizationId;
  } catch {
    return undefined;
  }
};

export const printDeployResult = (logger: Logger, data: unknown): void => {
  if (data === undefined || data === null || data === "") {
    logger.info("Request succeeded (empty response).", "green");
    return;
  }
  if (logger.isJson()) {
    logger.json(data);
    return;
  }
  try {
    logger.info(JSON.stringify(data, null, 2));
  } catch {
    logger.info(String(data));
  }
};

export const printDeployResultWithContext = (
  logger: Logger,
  context: { envName?: string },
  command: string,
  result: unknown,
  extra: Record<string, unknown> = {}
): void => {
  if (logger.isJson()) {
    logger.json({
      command,
      environment: context.envName ?? null,
      ...extra,
      result,
    });
    return;
  }
  printDeployResult(logger, result);
};

export const printDeployWhatIf = (
  logger: Logger,
  context: { envName?: string },
  command: string,
  request: Record<string, unknown>
): void => {
  if (logger.isJson()) {
    logger.json({
      command,
      environment: context.envName ?? null,
      whatIf: true,
      request,
    });
    return;
  }
  printDeployResult(logger, { whatIf: true, request });
};

export const extractDeployEnvironmentList = (result: unknown): DeployEnvironment[] => {
  if (Array.isArray(result)) {
    return result as DeployEnvironment[];
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const items = record.items ?? record.data ?? record.environments;
    if (Array.isArray(items)) {
      return items as DeployEnvironment[];
    }
  }
  return [];
};

export const getEnvironmentType = (environment: DeployEnvironment): string | undefined => {
  const record = environment as Record<string, unknown>;
  const candidates = [
    record.projectType,
    record.projectTypeName,
    record.environmentType,
    record.type,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  const project = record.project;
  if (project && typeof project === "object") {
    const projectRecord = project as Record<string, unknown>;
    const projectCandidates = [
      projectRecord.projectType,
      projectRecord.projectTypeName,
      projectRecord.environmentType,
      projectRecord.type,
    ];
    for (const candidate of projectCandidates) {
      if (typeof candidate === "string") {
        return candidate;
      }
    }
  }

  return undefined;
};

export const filterEnvironmentsByType = (
  environments: DeployEnvironment[],
  type?: string
): DeployEnvironment[] => {
  if (!type) {
    return environments;
  }
  const normalized = type.toLowerCase();
  let sawType = false;
  const filtered = environments.filter((environment) => {
    const envType = getEnvironmentType(environment);
    if (!envType) {
      return false;
    }
    sawType = true;
    return envType.toLowerCase().includes(normalized);
  });
  return sawType ? filtered : environments;
};

export const resolveDeployProjectId = async (
  context: { token: string; baseUrl?: string; whatIf?: boolean },
  options: { project?: string }
): Promise<string | undefined> => {
  const selection = options.project;
  if (!selection) {
    return undefined;
  }
  if (context.whatIf) {
    return selection;
  }
  const projects = await fetchProjects({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  const project = selectMatch(projects, "Project", selection);
  return project.id ?? project.projectId;
};

export const resolveDeployEnvironmentId = async (
  context: {
    token: string;
    baseUrl?: string;
    envName?: string;
    environmentId?: string;
    whatIf?: boolean;
  },
  options: { id?: string; name?: string; project?: string }
): Promise<string> => {
  const selection = options.id ?? options.name;
  if (context.whatIf) {
    if (selection) {
      return selection;
    }
    if (context.environmentId) {
      return context.environmentId;
    }
    throw createScaiError("Environment ID is required for --what-if. Use --id.", "INPUT_INVALID", {
      hint: "Provide an explicit environment ID to avoid lookup calls.",
    });
  }
  if (!selection) {
    if (context.environmentId) {
      return context.environmentId;
    }
    const envHint = context.envName ? ` for --environment-name '${context.envName}'` : "";
    throw inputError(
      `Environment name or ID is required. Use --name/--id, or run init to store an environmentId${envHint}.`
    );
  }

  const projectId = await resolveDeployProjectId(context, options);
  if (projectId) {
    const environments = await fetchProjectEnvironments(
      { accessToken: context.token, baseUrl: context.baseUrl },
      projectId
    );
    const environment = selectMatch(environments, "Environment", selection);
    const environmentId = environment.id ?? environment.environmentId;
    if (!environmentId) {
      throw inputError("Environment ID was not available.");
    }
    return environmentId;
  }

  const listResult = await fetchEnvironments(
    { accessToken: context.token, baseUrl: context.baseUrl },
    {}
  );
  const list =
    (listResult as { items?: DeployEnvironment[] }).items ??
    (listResult as { data?: DeployEnvironment[] }).data ??
    (Array.isArray(listResult) ? (listResult as DeployEnvironment[]) : []);
  const environment = selectMatch(list, "Environment", selection);
  const environmentId = environment.id ?? environment.environmentId;
  if (!environmentId) {
    throw inputError("Environment ID was not available.");
  }
  return environmentId;
};

export const resolveEnvironmentType = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const type = record.type ?? record.environmentType ?? record.envType;
  return typeof type === "string" ? type.toLowerCase() : undefined;
};

export const resolveTenantTypeValue = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "prod" || normalized === "production") {
      return 1;
    }
    if (
      normalized === "nonprod" ||
      normalized === "non-production" ||
      normalized === "nonproduction"
    ) {
      return 0;
    }
  }
  return undefined;
};

export const resolveProjectIdValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return undefined;
};
