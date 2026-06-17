import { readRootConfiguration, readRootConfigurationFile } from "@/config/root-config";
import { getCmTokens, getDeployToken } from "@/shared/keychain";
import { resolveCredentialMatrix, type CredentialMatrix } from "@/shared/credential-matrix";
import { toLogger } from "../shared";
import type { CommonOptions } from "../types";
import type { EnvironmentConfiguration } from "@/config/types";

/**
 * Resolve the deploy token's freshness metadata. Per `docs/credentials.md`
 * the config file holds every token's non-secret metadata: the
 * `deployTokenExpiresIn` / `deployTokenLastUpdated` fields live on the
 * env profile.
 */
const resolveDeployTokenMeta = (
  env: EnvironmentConfiguration
): { expiresIn: number | null; lastUpdated: string | null } => ({
  expiresIn: env.deployTokenExpiresIn ?? null,
  lastUpdated: env.deployTokenLastUpdated ?? null,
});

/**
 * Summarize the CM authentication state into a single status string.
 * Client-credentials envs report completeness; otherwise the precedence is
 * keychain → cached → disabled → missing.
 */
const resolveCmAuth = (
  env: EnvironmentConfiguration,
  credentials: CredentialMatrix,
  hasCachedCmTokens: boolean
): string => {
  if (env.useClientCredentials) {
    return credentials.envClient || credentials.orgClient
      ? "client-credentials"
      : "client-credentials (incomplete)";
  }
  if (hasCachedCmTokens) {
    return "keychain";
  }
  if (env.accessToken || env.refreshToken) {
    return "cached";
  }
  if (env.cacheAuthenticationToken === false) {
    return "disabled";
  }
  return "missing";
};

/** Whether the env profile carries any meaningful configuration at all. */
const hasAnyConfig = (env: EnvironmentConfiguration): boolean =>
  Boolean(
    env.host ||
    env.authority ||
    env.ref ||
    env.organizationId ||
    env.tenantId ||
    env.projectId ||
    env.environmentId ||
    env.deployToken ||
    env.clientId ||
    env.audience ||
    env.useClientCredentials !== undefined ||
    env.allowWrite !== undefined ||
    (env.variables && Object.keys(env.variables).length > 0)
  );

/** Whether the deploy token's freshness metadata indicates it expires within 10 minutes. */
const isDeployTokenExpiringSoon = (meta: {
  expiresIn: number | null;
  lastUpdated: string | null;
}): boolean => {
  if (!meta.expiresIn || !meta.lastUpdated) {
    return false;
  }
  const last = Date.parse(meta.lastUpdated);
  if (Number.isNaN(last)) {
    return false;
  }
  const expiresAt = last + meta.expiresIn * 1000;
  const msRemaining = expiresAt - Date.now();
  return msRemaining <= 10 * 60 * 1000;
};

/** Build the JSON status row for a single environment. */
const buildJsonResult = (params: {
  name: string;
  env: EnvironmentConfiguration;
  isDefault: boolean;
  credentials: CredentialMatrix;
  hasCachedCmTokens: boolean;
  hasDeployToken: boolean;
  deployTokenMeta: { expiresIn: number | null; lastUpdated: string | null };
}): Record<string, unknown> => {
  const { name, env, isDefault, credentials, hasCachedCmTokens, hasDeployToken, deployTokenMeta } =
    params;
  return {
    name,
    isDefault,
    host: env.host ?? null,
    authority: env.authority ?? null,
    ref: env.ref ?? null,
    environmentType: env.environmentType ?? null,
    ids: {
      organizationId: env.organizationId ?? null,
      tenantId: env.tenantId ?? null,
      projectId: env.projectId ?? null,
      environmentId: env.environmentId ?? null,
    },
    editingHostEnvironmentIds: env.editingHostEnvironmentIds ?? [],
    cmAuth: resolveCmAuth(env, credentials, hasCachedCmTokens),
    deployToken: hasDeployToken,
    allowWrite: Boolean(env.allowWrite),
    deployTokenExpiresIn: deployTokenMeta.expiresIn,
    deployTokenLastUpdated: deployTokenMeta.lastUpdated,
    credentials,
  };
};

/** Print the human-readable status block for one configured environment. */
const printEnvStatus = (
  logger: ReturnType<typeof toLogger>,
  params: {
    env: EnvironmentConfiguration;
    label: string;
    cmAuth: string;
    hasDeployToken: boolean;
    credentials: CredentialMatrix;
  }
): void => {
  const { env, label, cmAuth, hasDeployToken, credentials } = params;
  logger.info(`\n${label}`, "green");
  logger.info(`  host: ${env.host ?? "(not set)"}`);
  logger.info(`  authority: ${env.authority ?? "(not set)"}`);
  if (env.ref) {
    logger.info(`  ref: ${env.ref}`);
  }
  if (env.environmentType) {
    logger.info(`  environmentType: ${env.environmentType}`);
  }
  if (env.organizationId || env.tenantId || env.projectId || env.environmentId) {
    logger.info("  ids:");
    logger.info(`    organizationId: ${env.organizationId ?? "-"}`);
    logger.info(`    tenantId: ${env.tenantId ?? "-"}`);
    logger.info(`    projectId: ${env.projectId ?? "-"}`);
    logger.info(`    environmentId: ${env.environmentId ?? "-"}`);
  }
  if (env.editingHostEnvironmentIds && env.editingHostEnvironmentIds.length > 0) {
    logger.info("  editingHostEnvironmentIds:");
    for (const id of env.editingHostEnvironmentIds) {
      logger.info(`    ${id}`);
    }
  }
  logger.info(`  cmAuth: ${cmAuth}`);
  logger.info(`  deployToken: ${hasDeployToken ? "set" : "missing"}`);
  const deployTokenMeta = resolveDeployTokenMeta(env);
  if (isDeployTokenExpiringSoon(deployTokenMeta)) {
    logger.warn("  deployToken: expiring soon", "yellow");
  }
  logger.info(`  allowWrite: ${env.allowWrite ? "true" : "false"}`);

  const mark = (present: boolean): string => (present ? "ok" : "missing");
  logger.info("  credentials:");
  logger.info(`    env client: ${mark(credentials.envClient)}`);
  logger.info(`    org client: ${mark(credentials.orgClient)}`);
  logger.info(`    brand:      ${mark(credentials.brand)}`);
};

export const runStatus = async (options: CommonOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const rootConfigFile = readRootConfigurationFile(configPath);
  const defaultName = rootConfigFile.config.defaultEnvProfile;
  const root = readRootConfiguration(configPath, defaultName);
  const envProfiles = rootConfigFile.config.envProfiles ?? {};
  const reservedName = "default";
  const names = Object.keys(envProfiles)
    .filter((name) => name !== reservedName)
    .sort((a, b) => a.localeCompare(b));

  /** Resolve the credential matrix (env client / org client / brand) for one environment. */
  const resolveCredentials = (
    name: string,
    env: (typeof root.environments)[string]
  ): ReturnType<typeof resolveCredentialMatrix> => {
    const orgId = env.organizationId;
    return resolveCredentialMatrix(
      name,
      env,
      Boolean(orgId && root.brand?.[orgId]),
      Boolean(orgId && root.orgClients?.[orgId]?.clientId)
    );
  };

  if (logger.isJson()) {
    const results = [];
    for (const name of names) {
      const env = root.environments[name] ?? envProfiles[name];
      const cachedCmTokens =
        env.cacheAuthenticationToken === false ? undefined : await getCmTokens(name);
      const hasCachedCmTokens = Boolean(
        cachedCmTokens?.accessToken || cachedCmTokens?.refreshToken
      );
      const deployToken = (await getDeployToken(name)) ?? env.deployToken;
      const deployTokenMeta = resolveDeployTokenMeta(env);
      const credentials = await resolveCredentials(name, env);
      results.push(
        buildJsonResult({
          name,
          env,
          isDefault: name === defaultName,
          credentials,
          hasCachedCmTokens,
          hasDeployToken: Boolean(deployToken),
          deployTokenMeta,
        })
      );
    }
    logger.json({
      defaultEnvProfile: defaultName ?? null,
      envProfiles: results,
    });
    return;
  }

  logger.info(`Default environment: ${defaultName ?? "(not set)"}`, "cyan");
  if (defaultName === reservedName) {
    logger.warn(
      "The environment name 'default' is reserved. Choose a different name and set it as default."
    );
  } else if (defaultName && !envProfiles[defaultName]) {
    logger.warn(
      `Default environment '${defaultName}' was not found in env profiles. Run init to add it.`
    );
  }
  if (envProfiles[reservedName]) {
    logger.warn("Found a reserved 'default' environment entry. It will be ignored by status.");
  }

  if (names.length === 0) {
    logger.warn("No environments are configured. Use the init command to add one.");
    return;
  }

  for (const name of names) {
    const env = root.environments[name] ?? envProfiles[name];
    const cachedCmTokens =
      env.cacheAuthenticationToken === false ? undefined : await getCmTokens(name);
    const hasCachedCmTokens = Boolean(cachedCmTokens?.accessToken || cachedCmTokens?.refreshToken);
    const deployToken = (await getDeployToken(name)) ?? env.deployToken;
    const credentials = await resolveCredentials(name, env);
    const hasConfig = hasAnyConfig(env);
    const cmAuth = resolveCmAuth(env, credentials, hasCachedCmTokens);
    const hasDeployToken = Boolean(deployToken);
    const label = name === defaultName ? `${name} (default)` : name;
    if (!hasConfig) {
      logger.warn(`\n${label}`, "yellow");
      logger.info("  status: empty (not configured)");
      continue;
    }
    printEnvStatus(logger, { env, label, cmAuth, hasDeployToken, credentials });
  }
};
