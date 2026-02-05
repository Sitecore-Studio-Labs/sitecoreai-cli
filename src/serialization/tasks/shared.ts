import {
  readRootConfiguration,
  readRootConfigurationFile,
  readSerializationModules,
  RootConfiguration,
  SerializationModuleConfiguration,
} from "@/config";
import { FilesystemTreeSpec } from "../tree-spec";
import { Logger } from "@/shared/logger";
import { promptConfirm, promptText } from "@/shared/prompt";
import { createCliError } from "@/shared/errors";
import { getDeployToken } from "@/shared/keychain";
import {
  fetchOrganization,
  fetchProjects,
  fetchProjectEnvironments,
  fetchEnvironments,
  DeployEnvironment,
} from "@/deploy/api";
import type { CommonOptions } from "./types";

export const toLogger = (options: CommonOptions): Logger => {
  const logFile = options.logFile ?? process.env.SITECOREAI_LOG_FILE;
  return new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    logFile
  );
};

export const applyIfDefined = <T>(target: T, key: keyof T, value: T[keyof T] | undefined): void => {
  if (value !== undefined) {
    target[key] = value;
  }
};

export const inputError = (message: string, hint?: string): Error =>
  createCliError(message, "INPUT_INVALID", hint ? { hint } : {});

export const confirmDestructive = async (message: string, force?: boolean): Promise<boolean> => {
  if (force) {
    return true;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw createCliError("Confirmation required for destructive action.", "INPUT_INVALID", {
      hint: "Re-run with --force to skip the confirmation prompt.",
    });
  }
  return promptConfirm(message, false);
};

export const selectMatch = <
  T extends { id?: string; name?: string; projectId?: string; environmentId?: string },
>(
  list: T[],
  label: string,
  selection?: string
): T => {
  if (!selection) {
    if (list.length === 1) {
      return list[0];
    }
    throw inputError(
      `${label} must be specified when multiple results are available: ${list
        .map((item) => item.name ?? item.id ?? item.projectId ?? item.environmentId ?? "(unknown)")
        .join(", ")}`
    );
  }
  const match = list.find(
    (item) =>
      item.id === selection ||
      item.projectId === selection ||
      item.environmentId === selection ||
      (item.name && item.name.toLowerCase() === selection.toLowerCase())
  );
  if (!match) {
    throw inputError(`${label} '${selection}' was not found.`);
  }
  return match;
};

export const selectFromList = async <
  T extends { id?: string; name?: string; projectId?: string; environmentId?: string },
>(
  logger: Logger,
  label: string,
  list: T[]
): Promise<T> => {
  if (list.length === 1) {
    return list[0];
  }
  logger.info(`${label} choices:`, "cyan");
  list.forEach((item, index) => {
    const id = item.id ?? item.projectId ?? item.environmentId ?? "-";
    const name = item.name ?? id;
    logger.info(`  ${index + 1}) ${name} (${id})`);
  });
  const selection = await promptText(`${label} (number or id/name)`);
  const index = Number(selection);
  if (!Number.isNaN(index) && index >= 1 && index <= list.length) {
    return list[index - 1];
  }
  return selectMatch(list, label, selection);
};

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
  const configPath = options.config ?? process.cwd();
  const rootConfigFile = readRootConfigurationFile(configPath);
  const envName = options.environmentName ?? rootConfigFile.config.defaultEnvProfile ?? "default";
  const root = readRootConfiguration(configPath, envName);
  const env = root.environments[envName];
  if (!env) {
    throw createCliError(
      `Environment ${envName} is not configured. Run init first.`,
      "ENV_NOT_FOUND"
    );
  }
  const token = (await getDeployToken(envName)) ?? env?.deployToken;
  if (!token) {
    throw createCliError(`Deploy token not found for environment '${envName}'.`, "AUTH_REQUIRED", {
      hint: "Run 'scai init' or 'scai login' to authenticate.",
    });
  }
  return {
    token,
    baseUrl: undefined,
    envName,
    organizationId: env?.organizationId,
    projectId: env?.projectId,
    environmentId: env?.environmentId,
    environmentType: env?.environmentType,
    editingHostEnvironmentIds: env?.editingHostEnvironmentIds,
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
    throw createCliError("Environment ID is required for --what-if. Use --id.", "INPUT_INVALID", {
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

export const loadConfigAndModules = async (
  options: CommonOptions
): Promise<{ root: RootConfiguration; modules: SerializationModuleConfiguration[] }> => {
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const envName =
    (options as { environmentName?: string }).environmentName ?? rootFile.config.defaultEnvProfile;
  const root = readRootConfiguration(configPath, envName);
  const modules = await readSerializationModules(root, options.include, options.exclude);
  return { root, modules };
};

export const groupSubtreesByDatabase = (
  modules: SerializationModuleConfiguration[]
): Map<string, FilesystemTreeSpec[]> => {
  const map = new Map<string, FilesystemTreeSpec[]>();
  for (const module of modules) {
    for (const subtree of module.items.includes) {
      if (!map.has(subtree.database)) {
        map.set(subtree.database, []);
      }
      map.get(subtree.database)!.push(subtree);
    }
  }
  return map;
};

export const ensureAllowWrite = (root: RootConfiguration, environmentName: string): void => {
  const env = root.environments[environmentName];
  if (!env?.allowWrite) {
    const envKey = environmentName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    throw createCliError(
      `Environment ${environmentName} is not configured to allow writing data.`,
      "INPUT_INVALID",
      {
        hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
      }
    );
  }
};

export const resolveApiTimeoutMs = (root: RootConfiguration): number | undefined => {
  const minutes = root.settings.apiClientTimeoutInMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return minutes * 60 * 1000;
};
