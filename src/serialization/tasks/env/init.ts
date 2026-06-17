// TODO(recipe-init): when the wizard runs in a non-default project layout,
// auto-detect `*.recipe.ts` files and offer to set the `recipes` glob in
// sitecoreai.cli.json accordingly. Today the default config template ships
// `recipes: ["recipes/**/*.recipe.ts"]`; users with recipes elsewhere edit
// the file by hand. Worth adding once orchestrator-mediated installs land
// (Phase 3) — until then, agent-mediated installs control the layout.

import fsSync from "node:fs";
import {
  readRootConfiguration,
  readRootConfigurationFile,
  writeRootConfigurationFile,
} from "@/config/root-config";
import { assertValidHost } from "@/shared/validate";
import { resolveTargetPath, writeConfigTemplate } from "@/shared/config-template";
import { setDeployToken } from "@/shared/keychain";
import { assertInteractive, promptConfirm, promptText } from "@/shared/prompt";
import { createScaiError, toScaiError } from "@/shared/errors";
import { applyIfDefined, inputError, toLogger } from "../shared";
import type { ConnectOptions } from "../types";
import type { EnvironmentConfiguration } from "@/config/types";
import { resolveDeployAuth } from "./init/auth";
import { resolveDeployLookup } from "./init/deploy-lookup";

/** Whether the caller supplied any explicit configuration flag (vs. a bare wizard run). */
const hasExplicitInput = (options: ConnectOptions): boolean =>
  Boolean(
    options.environmentName ||
    options.cm ||
    options.host ||
    options.ref ||
    options.allowWrite !== undefined ||
    options.organizationId ||
    options.tenantId ||
    options.organization ||
    options.project ||
    options.environment ||
    options.deployToken ||
    options.clientId ||
    options.clientSecret ||
    options.useClientCredentials !== undefined ||
    options.setDefault
  );

/** Whether the run mutates env-profile fields (anything beyond a bare `--set-default`). */
const hasOtherChanges = (options: ConnectOptions): boolean =>
  Boolean(
    options.cm || options.host || options.organization || options.project || options.environment
  ) ||
  Boolean(options.deployToken || options.clientId || options.clientSecret) ||
  Boolean(options.useClientCredentials || options.ref || options.allowWrite) ||
  Boolean(options.organizationId || options.tenantId);

/** Validate that a `--ref` target exists and does not itself chain to another ref. */
const assertRefIsValid = (
  ref: string,
  envProfiles: Record<string, EnvironmentConfiguration>
): void => {
  const refEnv = envProfiles[ref];
  if (!refEnv) {
    throw createScaiError(`Referenced environment '${ref}' was not found.`, "ENV_NOT_FOUND");
  }
  if (refEnv.ref) {
    throw inputError(
      `Referenced environment '${ref}' cannot itself reference another environment.`
    );
  }
};

/** Persist the resolved client ID onto the profile per the credential mode. */
const applyClientId = (
  updated: EnvironmentConfiguration,
  params: {
    loginClientId?: string;
    wantsClientCredentials: boolean;
    shouldPersistClientId: boolean;
  }
): void => {
  const { loginClientId, wantsClientCredentials, shouldPersistClientId } = params;
  if (!loginClientId) {
    return;
  }
  if (wantsClientCredentials) {
    updated.clientId = loginClientId;
  } else if (!updated.clientId && shouldPersistClientId) {
    updated.clientId = loginClientId;
  }
};

/**
 * Read the root config, recovering from a CONFIG_INVALID error in the wizard
 * by offering to back up and recreate it. Returns `null` when the user
 * declines the recreation (caller should treat this as a cancellation).
 */
const loadOrRecreateConfig = async (params: {
  configPath: string;
  targetPath: string;
  runWizard: boolean;
  isInteractive: boolean;
  logger: ReturnType<typeof toLogger>;
}): Promise<ReturnType<typeof readRootConfigurationFile> | null> => {
  const { configPath, targetPath, runWizard, isInteractive, logger } = params;
  try {
    return readRootConfigurationFile(configPath);
  } catch (error) {
    const cliError = toScaiError(error);
    if (!(cliError.code === "CONFIG_INVALID" && runWizard && isInteractive)) {
      throw error;
    }
    const recreate = await promptConfirm(
      `Configuration file at ${targetPath} is invalid. Recreate it?`,
      false
    );
    if (!recreate) {
      logger.info("Init cancelled. No changes were made.");
      return null;
    }
    if (fsSync.existsSync(targetPath)) {
      const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
      const backupPath = `${targetPath}.invalid-${timestamp}`;
      fsSync.renameSync(targetPath, backupPath);
      logger.warn(`Backed up invalid config to ${backupPath}`);
    }
    writeConfigTemplate(targetPath);
    logger.info(`Recreated ${targetPath}`, "green");
    return readRootConfigurationFile(configPath);
  }
};

type WizardEnvState = {
  envName: string;
  root: ReturnType<typeof readRootConfiguration>;
  existing: EnvironmentConfiguration;
  envExists: boolean;
  baseEnv: EnvironmentConfiguration;
};

/**
 * In the wizard, re-prompt for an environment name until the chosen name is
 * neither the reserved `default` nor an existing profile the user declines to
 * overwrite. Returns `null` when the user cancels.
 */
const resolveEnvNameForWizard = async (params: {
  initial: WizardEnvState;
  configPath: string;
  envProfiles: Record<string, EnvironmentConfiguration>;
  reservedName: string;
  logger: ReturnType<typeof toLogger>;
}): Promise<WizardEnvState | null> => {
  const { configPath, envProfiles, reservedName, logger } = params;
  let { envName, root, existing, envExists, baseEnv } = params.initial;
  const reload = (name: string): WizardEnvState => {
    const nextRoot = readRootConfiguration(configPath, name);
    return {
      envName: name,
      root: nextRoot,
      existing: envProfiles[name] ?? {},
      envExists: Boolean(envProfiles[name]),
      baseEnv: nextRoot.environments[name] ?? {},
    };
  };
  while (envExists || envName.toLowerCase() === reservedName) {
    if (envName.toLowerCase() === reservedName) {
      const newName = await promptText("Environment name cannot be 'default'. Choose another name");
      if (!newName) {
        logger.info("Init cancelled. No changes were made.");
        return null;
      }
      ({ envName, root, existing, envExists, baseEnv } = reload(newName));
      continue;
    }
    const overwrite = await promptConfirm(
      `Environment '${envName}' already exists. Overwrite?`,
      false
    );
    if (overwrite) {
      break;
    }
    const newName = await promptText(
      "Choose a different environment name (local label; does not need to match SitecoreAI)"
    );
    if (!newName) {
      logger.info("Init cancelled. No changes were made.");
      return null;
    }
    ({ envName, root, existing, envExists, baseEnv } = reload(newName));
  }
  return { envName, root, existing, envExists, baseEnv };
};

/**
 * Decide whether this run needs a deploy lookup (org/project/environment
 * resolution) and/or a deploy token. The wizard always needs both; explicit
 * flags drive the non-wizard path; the skip flag suppresses the lookup.
 */
const resolveDeployNeeds = (
  options: ConnectOptions,
  runWizard: boolean
): { needsDeployLookup: boolean; needsDeployToken: boolean } => {
  const skipDeployLookup =
    Boolean(options.skipDeployLookup) || process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP === "1";
  let needsDeployLookup = Boolean(options.organization || options.project || options.environment);
  if (skipDeployLookup) {
    needsDeployLookup = false;
  }
  if (runWizard && !needsDeployLookup && !skipDeployLookup) {
    needsDeployLookup = true;
  }
  const needsDeployToken =
    runWizard ||
    needsDeployLookup ||
    Boolean(options.deployToken || options.clientId || options.clientSecret);
  return { needsDeployLookup, needsDeployToken };
};

/**
 * Handle a bare `--set-default` run (no other field changes): point the
 * default at an already-configured env and persist. Returns `true` when this
 * path handled the run (caller should return early).
 */
const handleSetDefaultOnly = (params: {
  options: ConnectOptions;
  otherChanges: boolean;
  envProfiles: Record<string, EnvironmentConfiguration>;
  rootConfigFile: ReturnType<typeof readRootConfigurationFile>;
  configPath: string;
  envName: string;
  logger: ReturnType<typeof toLogger>;
}): boolean => {
  const { options, otherChanges, envProfiles, rootConfigFile, configPath, envName, logger } =
    params;
  if (!(options.setDefault && !otherChanges)) {
    return false;
  }
  if (!envProfiles[envName]) {
    throw createScaiError(
      `Environment '${envName}' does not exist. Configure it before setting default.`,
      "ENV_NOT_FOUND"
    );
  }
  rootConfigFile.config.defaultEnvProfile = envName;
  writeRootConfigurationFile(configPath, rootConfigFile.config);
  logger.info(`Default environment set to '${envName}'.`, "green");
  return true;
};

/**
 * Persist a freshly-minted deploy token into the keychain (warning on
 * failure) and copy its freshness metadata onto the env profile. No-op
 * when this run did not need or produce a token.
 */
const persistDeployToken = async (params: {
  needsDeployToken: boolean;
  deployToken?: string;
  envName: string;
  updated: EnvironmentConfiguration;
  deployTokenMeta?: { expiresIn: number | null; lastUpdated: string };
  logger: ReturnType<typeof toLogger>;
}): Promise<void> => {
  const { needsDeployToken, deployToken, envName, updated, deployTokenMeta, logger } = params;
  if (!(needsDeployToken && deployToken)) {
    return;
  }
  const stored = await setDeployToken(envName, deployToken);
  if (!stored) {
    logger.warn(
      "Unable to store the Deploy token in the OS keychain. Use SITECOREAI_DEPLOY_TOKEN if needed."
    );
  }
  // Deploy-token freshness metadata lives on the env profile in the
  // config file (see docs/credentials.md). Only present when this run
  // actually performed a login.
  if (deployTokenMeta) {
    updated.deployTokenExpiresIn = deployTokenMeta.expiresIn;
    updated.deployTokenLastUpdated = deployTokenMeta.lastUpdated;
  }
};

/**
 * Resolve the final CM host: keep the resolved value, prompt in the
 * wizard when empty, else error. Validates the chosen host.
 */
const resolveFinalHost = async (params: { host?: string; runWizard: boolean }): Promise<string> => {
  let { host } = params;
  if (!host && params.runWizard) {
    host = await promptText("CM host (base URL)", host);
  }
  if (!host) {
    throw inputError("Environment host is required. Use --cm/--host or select it via Deploy.");
  }
  assertValidHost(host, "CM host");
  return host;
};

/**
 * Write the resolved auth + flag fields onto the env profile, mirroring
 * the original field-by-field application order.
 */
const applyResolvedEnvFields = async (params: {
  updated: EnvironmentConfiguration;
  host: string;
  options: ConnectOptions;
  runWizard: boolean;
  loginAuthority: string;
  loginClientId?: string;
  wantsClientCredentials: boolean;
  shouldPersistClientId: boolean;
}): Promise<void> => {
  const {
    updated,
    host,
    options,
    runWizard,
    loginAuthority,
    loginClientId,
    wantsClientCredentials,
    shouldPersistClientId,
  } = params;
  updated.host = host;
  if (!updated.authority) {
    updated.authority = loginAuthority;
  }
  applyClientId(updated, { loginClientId, wantsClientCredentials, shouldPersistClientId });
  applyIfDefined(updated, "ref", options.ref);
  if (options.allowWrite !== undefined) {
    updated.allowWrite = options.allowWrite;
  } else if (runWizard) {
    updated.allowWrite = await promptConfirm("Allow write operations?", false);
  }
  applyIfDefined(updated, "organizationId", options.organizationId);
  applyIfDefined(updated, "tenantId", options.tenantId);
  applyIfDefined(updated, "clientId", options.clientId);
  if (wantsClientCredentials) {
    updated.useClientCredentials = true;
  }
};

/** Apply the `--set-default` decision to the config (flag, non-wizard default, or wizard prompt). */
const applyDefaultEnvProfile = async (params: {
  options: ConnectOptions;
  rootConfigFile: ReturnType<typeof readRootConfigurationFile>;
  envName: string;
  runWizard: boolean;
}): Promise<void> => {
  const { options, rootConfigFile, envName, runWizard } = params;
  if (options.setDefault || (!rootConfigFile.config.defaultEnvProfile && !runWizard)) {
    rootConfigFile.config.defaultEnvProfile = envName;
    return;
  }
  if (runWizard) {
    const shouldSetDefault = await promptConfirm(
      "Set as default environment?",
      !rootConfigFile.config.defaultEnvProfile
    );
    if (shouldSetDefault) {
      rootConfigFile.config.defaultEnvProfile = envName;
    }
  }
};

export const runInit = async (options: ConnectOptions): Promise<void> => {
  const logger = toLogger(options);
  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && process.env.SITECOREAI_NON_INTERACTIVE !== "1";
  const runWizard = Boolean(options.wizard || !hasExplicitInput(options));
  if (runWizard && !isInteractive) {
    assertInteractive(
      "Wizard mode requires a TTY. Provide flags instead.",
      "Provide flags instead."
    );
  }
  let envName = options.environmentName;
  const reservedName = "default";
  if (!envName) {
    if (!runWizard) {
      throw inputError("Environment name is required. Use --environment-name.");
    }
    envName = await promptText("Environment name (local label; does not need to match SitecoreAI)");
    if (!envName) {
      throw inputError("Environment name is required.");
    }
  }
  if (runWizard && envName.toLowerCase() === reservedName) {
    envName = "";
  }

  const configPath = options.config ?? process.cwd();
  const targetPath = resolveTargetPath(configPath);
  if (!fsSync.existsSync(targetPath)) {
    writeConfigTemplate(targetPath);
    logger.info(`Created ${targetPath}`, "green");
  }
  const rootConfigFile = await loadOrRecreateConfig({
    configPath,
    targetPath,
    runWizard,
    isInteractive,
    logger,
  });
  if (!rootConfigFile) {
    return;
  }
  const envProfiles = rootConfigFile.config.envProfiles ?? {};
  let root = readRootConfiguration(configPath, envName);
  let existing = envProfiles[envName] ?? {};
  let envExists = Boolean(envProfiles[envName]);
  let baseEnv = root.environments[envName] ?? {};

  const otherChanges = hasOtherChanges(options);

  if (envExists && runWizard) {
    const resolved = await resolveEnvNameForWizard({
      initial: { envName, root, existing, envExists, baseEnv },
      configPath,
      envProfiles,
      reservedName,
      logger,
    });
    if (!resolved) {
      return;
    }
    ({ envName, existing, baseEnv } = resolved);
  } else if (envExists && !runWizard && otherChanges) {
    logger.warn(`Environment '${envName}' already exists and will be updated.`);
  }

  if (
    handleSetDefaultOnly({
      options,
      otherChanges,
      envProfiles,
      rootConfigFile,
      configPath,
      envName,
      logger,
    })
  ) {
    return;
  }

  if (options.ref) {
    assertRefIsValid(options.ref, envProfiles);
  }

  const updated = { ...existing };
  let host = options.cm ?? options.host ?? existing.host;
  const projectSelection = options.project;
  const environmentSelection = options.environment;
  const { needsDeployLookup, needsDeployToken } = resolveDeployNeeds(options, runWizard);

  const auth = await resolveDeployAuth({
    options,
    envName,
    existing,
    baseEnv,
    runWizard,
    isInteractive,
    needsDeployToken,
    logger,
  });
  const deployToken = auth.deployToken;
  const { loginAuthority, loginClientId, wantsClientCredentials, shouldPersistClientId } = auth;

  if (needsDeployLookup) {
    const lookup = await resolveDeployLookup({
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
    });
    host = lookup.host;
  }

  await persistDeployToken({
    needsDeployToken,
    deployToken,
    envName,
    updated,
    deployTokenMeta: auth.deployTokenMeta,
    logger,
  });

  host = await resolveFinalHost({ host, runWizard });

  await applyResolvedEnvFields({
    updated,
    host,
    options,
    runWizard,
    loginAuthority,
    loginClientId,
    wantsClientCredentials,
    shouldPersistClientId,
  });

  rootConfigFile.config.envProfiles = {
    ...envProfiles,
    [envName]: updated,
  };
  await applyDefaultEnvProfile({ options, rootConfigFile, envName, runWizard });

  writeRootConfigurationFile(configPath, rootConfigFile.config);
  logger.info(`Initialized environment '${envName}' in sitecoreai.cli.json`, "green");
};
