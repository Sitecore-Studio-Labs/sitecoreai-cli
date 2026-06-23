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
import { discoverSites } from "@/authoring";
import { selectFromList } from "@/shared/cli-tasks";

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

/**
 * Match a site name (case-insensitive) against a discovered site list and
 * return its collection (parent tenant). Pure + exported for unit testing the
 * matching independently of the network discovery call.
 */
export const matchSiteCollection = (
  sites: ReadonlyArray<{ name: string; tenantName: string }>,
  site: string
): string | undefined => {
  const match = sites.find(
    (candidate) => candidate.name.localeCompare(site, undefined, { sensitivity: "accent" }) === 0
  );
  return match?.tenantName?.trim() || undefined;
};

/**
 * Best-effort: discover the site collection from the environment's sites.
 * Returns `undefined` on any failure (discovery needs CM auth that may not be
 * provisioned at init time) so the caller can fall back to a prompt or warning
 * — init must never block on this.
 */
const discoverSiteCollection = async (params: {
  environment: EnvironmentConfiguration;
  envName: string;
  site: string;
  logger: ReturnType<typeof toLogger>;
}): Promise<string | undefined> => {
  const { environment, envName, site, logger } = params;
  try {
    const sites = await discoverSites({ ...environment, name: envName });
    const collection = matchSiteCollection(sites, site);
    if (collection) {
      logger.info(`Discovered site collection '${collection}' for site '${site}'.`, "green");
    }
    return collection;
  } catch {
    return undefined;
  }
};

/**
 * Best-effort site picker: discover the environment's SXA sites and let the
 * operator choose one from a list. Selecting a site resolves BOTH its name and
 * its collection (parent tenant) in a single step — no typing, no name match.
 *
 * Returns `undefined` (so the caller falls back to a text prompt) when discovery
 * fails — it needs CM auth, which may not be provisioned at init time — or when
 * the environment has no sites.
 */
const pickSiteFromEnvironment = async (params: {
  environment: EnvironmentConfiguration;
  envName: string;
  logger: ReturnType<typeof toLogger>;
}): Promise<{ site: string; collection: string } | undefined> => {
  const { environment, envName, logger } = params;
  let sites: Awaited<ReturnType<typeof discoverSites>>;
  try {
    sites = await discoverSites({ ...environment, name: envName });
  } catch {
    return undefined;
  }
  const choices = sites
    .filter((s) => s.name && s.tenantName)
    // `selectFromList` renders `name (id)` — surface the collection as the id so
    // the operator sees `MySite (MyTenant)` and the pick carries both values.
    .map((s) => ({ name: s.name, id: s.tenantName }));
  if (choices.length === 0) {
    return undefined;
  }
  const picked = await selectFromList(logger, "Site", choices);
  return { site: picked.name as string, collection: picked.id as string };
};

/**
 * Resolve and persist the SXA site name + collection so `scai provision recipe`
 * derives the full recipeRoots set without hand-authored paths.
 *
 *   site + collection: --site / --site-collection flags > existing profile >
 *     wizard site picker (discovered list) > site text prompt + collection discovery
 *
 * No-op when no site is resolved (a non-recipe environment leaves the profile
 * untouched). The picker and discovery are best-effort; a miss falls back to a
 * text prompt in the wizard or a warning otherwise, so init never blocks.
 */
export const resolveSiteIdentity = async (params: {
  options: ConnectOptions;
  updated: EnvironmentConfiguration;
  envName: string;
  runWizard: boolean;
  logger: ReturnType<typeof toLogger>;
}): Promise<void> => {
  const { options, updated, envName, runWizard, logger } = params;

  let site = options.site?.trim() || updated.site?.trim();
  let collection = options.siteCollection?.trim() || updated.siteCollection?.trim();

  // Wizard, nothing pre-set by flags/profile: offer a picker of discovered sites.
  // Picking one fills both site and collection at once.
  if (runWizard && !site && !collection) {
    const picked = await pickSiteFromEnvironment({ environment: updated, envName, logger });
    if (picked) {
      site = picked.site;
      collection = picked.collection;
    }
  }

  if (!site && runWizard) {
    site =
      (
        await promptText("SXA Headless site name for recipe authoring (blank to skip)", envName)
      )?.trim() || undefined;
  }
  if (!site) {
    return;
  }
  updated.site = site;

  if (!collection) {
    collection = await discoverSiteCollection({ environment: updated, envName, site, logger });
  }
  if (!collection && runWizard) {
    collection =
      (
        await promptText(
          `Site collection (parent tenant) for '${site}' — couldn't discover it automatically (blank to set later)`
        )
      )?.trim() || undefined;
  }

  if (collection) {
    updated.siteCollection = collection;
    logger.info(
      `recipeRoots will derive from site '${site}' / collection '${collection}'.`,
      "green"
    );
  } else {
    logger.warn(
      `Site collection not set for '${site}'. Recipe commands need it — set 'siteCollection' on '${envName}', ` +
        `pass --site-collection, or run 'scai provision recipe roots --site ${site} -n ${envName}'.`
    );
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

  await resolveSiteIdentity({ options, updated, envName, runWizard, logger });

  rootConfigFile.config.envProfiles = {
    ...envProfiles,
    [envName]: updated,
  };
  await applyDefaultEnvProfile({ options, rootConfigFile, envName, runWizard });

  writeRootConfigurationFile(configPath, rootConfigFile.config);
  logger.info(`Initialized environment '${envName}' in sitecoreai.cli.json`, "green");
};
