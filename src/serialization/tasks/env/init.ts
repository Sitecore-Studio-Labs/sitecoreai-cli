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
import { resolveDeployAuth } from "./init/auth";
import { resolveDeployLookup } from "./init/deploy-lookup";

export const runInit = async (options: ConnectOptions): Promise<void> => {
  const logger = toLogger(options);
  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && process.env.SITECOREAI_NON_INTERACTIVE !== "1";
  const hasExplicitInput = Boolean(
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
  const runWizard = Boolean(options.wizard || !hasExplicitInput);
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
  let rootConfigFile: ReturnType<typeof readRootConfigurationFile>;
  try {
    rootConfigFile = readRootConfigurationFile(configPath);
  } catch (error) {
    const cliError = toScaiError(error);
    if (cliError.code === "CONFIG_INVALID" && runWizard && isInteractive) {
      const recreate = await promptConfirm(
        `Configuration file at ${targetPath} is invalid. Recreate it?`,
        false
      );
      if (!recreate) {
        logger.info("Init cancelled. No changes were made.");
        return;
      }
      if (fsSync.existsSync(targetPath)) {
        const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
        const backupPath = `${targetPath}.invalid-${timestamp}`;
        fsSync.renameSync(targetPath, backupPath);
        logger.warn(`Backed up invalid config to ${backupPath}`);
      }
      writeConfigTemplate(targetPath);
      logger.info(`Recreated ${targetPath}`, "green");
      rootConfigFile = readRootConfigurationFile(configPath);
    } else {
      throw error;
    }
  }
  const envProfiles = rootConfigFile.config.envProfiles ?? {};
  let root = readRootConfiguration(configPath, envName);
  let existing = envProfiles[envName] ?? {};
  let envExists = Boolean(envProfiles[envName]);
  let baseEnv = root.environments[envName] ?? {};

  const hasOtherChanges =
    Boolean(
      options.cm || options.host || options.organization || options.project || options.environment
    ) ||
    Boolean(options.deployToken || options.clientId || options.clientSecret) ||
    Boolean(options.useClientCredentials || options.ref || options.allowWrite) ||
    Boolean(options.organizationId || options.tenantId);

  if (envExists && runWizard) {
    while (envExists || envName.toLowerCase() === reservedName) {
      if (envName.toLowerCase() === reservedName) {
        const newName = await promptText(
          "Environment name cannot be 'default'. Choose another name"
        );
        if (!newName) {
          logger.info("Init cancelled. No changes were made.");
          return;
        }
        envName = newName;
        root = readRootConfiguration(configPath, envName);
        existing = envProfiles[envName] ?? {};
        envExists = Boolean(envProfiles[envName]);
        baseEnv = root.environments[envName] ?? {};
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
        return;
      }
      envName = newName;
      root = readRootConfiguration(configPath, envName);
      existing = envProfiles[envName] ?? {};
      envExists = Boolean(envProfiles[envName]);
      baseEnv = root.environments[envName] ?? {};
    }
  } else if (envExists && !runWizard && hasOtherChanges) {
    logger.warn(`Environment '${envName}' already exists and will be updated.`);
  }

  if (options.setDefault && !hasOtherChanges) {
    if (!envProfiles[envName]) {
      throw createScaiError(
        `Environment '${envName}' does not exist. Configure it before setting default.`,
        "ENV_NOT_FOUND"
      );
    }
    rootConfigFile.config.defaultEnvProfile = envName;
    writeRootConfigurationFile(configPath, rootConfigFile.config);
    logger.info(`Default environment set to '${envName}'.`, "green");
    return;
  }

  if (options.ref) {
    const refEnv = envProfiles[options.ref];
    if (!refEnv) {
      throw createScaiError(
        `Referenced environment '${options.ref}' was not found.`,
        "ENV_NOT_FOUND"
      );
    }
    if (refEnv.ref) {
      throw inputError(
        `Referenced environment '${options.ref}' cannot itself reference another environment.`
      );
    }
  }

  const updated = { ...existing };
  let host = options.cm ?? options.host ?? existing.host;
  let projectSelection = options.project;
  let environmentSelection = options.environment;
  const skipDeployLookup =
    Boolean(options.skipDeployLookup) || process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP === "1";
  let needsDeployLookup = Boolean(options.organization || projectSelection || environmentSelection);
  if (skipDeployLookup) {
    needsDeployLookup = false;
  }
  if (runWizard && !needsDeployLookup && !skipDeployLookup) {
    needsDeployLookup = true;
  }
  let needsDeployToken =
    needsDeployLookup || Boolean(options.deployToken || options.clientId || options.clientSecret);
  if (runWizard) {
    needsDeployToken = true;
  }

  const auth = await resolveDeployAuth({
    options,
    envName,
    existing,
    baseEnv,
    runWizard,
    isInteractive,
    needsDeployToken,
    updated,
    logger,
  });
  let deployToken = auth.deployToken;
  const loginAuthority = auth.loginAuthority;
  const loginClientId = auth.loginClientId;
  const wantsClientCredentials = auth.wantsClientCredentials;
  const shouldPersistClientId = auth.shouldPersistClientId;

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

  if (needsDeployToken && deployToken) {
    const stored = await setDeployToken(envName, deployToken);
    if (!stored) {
      logger.warn(
        "Unable to store the Deploy token in the OS keychain. Use SITECOREAI_DEPLOY_TOKEN if needed."
      );
    }
  }

  if (!host && runWizard) {
    host = await promptText("CM host (base URL)", host);
  }
  if (!host) {
    throw inputError("Environment host is required. Use --cm/--host or select it via Deploy.");
  }
  assertValidHost(host, "CM host");

  updated.host = host;
  if (!updated.authority) {
    updated.authority = loginAuthority;
  }
  if (loginClientId) {
    if (wantsClientCredentials) {
      updated.clientId = loginClientId;
    } else if (!updated.clientId && shouldPersistClientId) {
      updated.clientId = loginClientId;
    }
  }
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

  rootConfigFile.config.envProfiles = {
    ...envProfiles,
    [envName]: updated,
  };
  if (options.setDefault || (!rootConfigFile.config.defaultEnvProfile && !runWizard)) {
    rootConfigFile.config.defaultEnvProfile = envName;
  } else if (runWizard) {
    const shouldSetDefault = await promptConfirm(
      "Set as default environment?",
      !rootConfigFile.config.defaultEnvProfile
    );
    if (shouldSetDefault) {
      rootConfigFile.config.defaultEnvProfile = envName;
    }
  }

  writeRootConfigurationFile(configPath, rootConfigFile.config);
  logger.info(`Initialized environment '${envName}' in sitecoreai.cli.json`, "green");
};
