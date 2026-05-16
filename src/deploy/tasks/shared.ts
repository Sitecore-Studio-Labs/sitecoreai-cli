/**
 * Helpers specific to `scai provision deploy` task runners — env-context
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
import { buildScaiEnvelope } from "@/shared/envelope";
import { fetchOrganization } from "@/deploy/api/organizations";
import { fetchAllProjects, fetchAllProjectEnvironments } from "@/deploy/api/projects";
import { fetchAllEnvironments } from "@/deploy/api/environments";
import type { DeployEnvironment } from "@/deploy/api/common/types";

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
      hint: "Run 'scai setup init' or 'scai setup login' to authenticate.",
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
    // `extra` keys overlapping with canonical envelope fields
    // (totalCount, pageSize, whatIf, etc.) are hoisted to envelope-
    // level; anything else lands under `meta`. Keeps the top-level
    // namespace clean while preserving the caller's ability to attach
    // pagination metadata without nesting it under `data`.
    logger.json(buildScaiEnvelope({ command, environment: context.envName, data: result, extra }));
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
    logger.json(
      buildScaiEnvelope({
        command,
        environment: context.envName,
        data: request,
        extra: { whatIf: true },
      })
    );
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
  // Walk every page when matching a project by name/ID — the v2
  // endpoint paginates at 10, so single-page lookups produce spurious
  // "not found" errors the moment an org has more than 10 projects.
  const aggregated = await fetchAllProjects({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  const project = selectMatch(aggregated.items, "Project", selection);
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
  // `--id` is authoritative: skip the lookup round-trip entirely. The
  // previous behaviour validated `--id` against a paginated project
  // listing (`fetchProjectEnvironments` returns only the first page),
  // which made `delete --id <known-good-id>` fall over with a spurious
  // "not found" the moment a project grew past 10 environments. If the
  // ID is wrong, the API call that follows will surface the 404 with
  // its own clear error — no need to pre-validate.
  if (options.id) {
    return options.id;
  }
  const selection = options.name;
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
    // Walk every page of the project's environments. The default
    // page size on this endpoint is 10, so a project with >10 envs
    // would otherwise fail name lookups for anything past page one.
    const aggregated = await fetchAllProjectEnvironments(
      { accessToken: context.token, baseUrl: context.baseUrl },
      projectId
    );
    const environment = selectMatch(aggregated.items, "Environment", selection);
    const environmentId = environment.id ?? environment.environmentId;
    if (!environmentId) {
      throw inputError("Environment ID was not available.");
    }
    return environmentId;
  }

  // Same reason as above: walk all pages when scanning the org-wide
  // list. `fetchAllEnvironments` returns `{ items, totalCount, ... }`
  // — only `items` matters here, since we're picking one by name/ID.
  const aggregated = await fetchAllEnvironments(
    { accessToken: context.token, baseUrl: context.baseUrl },
    {}
  );
  const environment = selectMatch(aggregated.items, "Environment", selection);
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
