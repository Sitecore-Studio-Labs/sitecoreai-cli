import { readRootConfigurationFile, writeRootConfigurationFile } from "@/config/root-config";
import { clearCmTokens, clearDeployToken } from "@/shared/keychain";
import { createScaiError } from "@/shared/errors";
import { toLogger } from "../shared";
import type { LogoutOptions } from "../types";

export const runLogout = async (options: LogoutOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const rootConfigFile = readRootConfigurationFile(configPath);
  const envProfiles = rootConfigFile.config.envProfiles ?? {};
  const names = Object.keys(envProfiles);

  if (options.all) {
    for (const name of names) {
      const env = envProfiles[name];
      envProfiles[name] = {
        ...env,
        accessToken: undefined,
        refreshToken: undefined,
        refreshTokenParameters: undefined,
        expiresIn: undefined,
        lastUpdated: undefined,
        deployToken: undefined,
        deployTokenExpiresIn: undefined,
        deployTokenLastUpdated: undefined,
        // clientSecret is a token-minting credential — clearing it on
        // logout matches the "no creds left on disk" mental model.
        // clientId is left in place (identifier, not secret).
        clientSecret: undefined,
      };
      await clearCmTokens(name);
      await clearDeployToken(name);
    }
    rootConfigFile.config.envProfiles = envProfiles;
    writeRootConfigurationFile(configPath, rootConfigFile.config);
    logger.info("Cleared stored tokens for all environments.", "green");
    return;
  }

  const envName = options.environmentName;
  if (!envName) {
    throw createScaiError(
      "Environment name is required. Use --environment-name or --all.",
      "INPUT_INVALID"
    );
  }
  const env = envProfiles[envName];
  if (!env) {
    throw createScaiError(`Environment '${envName}' does not exist.`, "ENV_NOT_FOUND");
  }
  envProfiles[envName] = {
    ...env,
    accessToken: undefined,
    refreshToken: undefined,
    refreshTokenParameters: undefined,
    expiresIn: undefined,
    lastUpdated: undefined,
    deployToken: undefined,
    deployTokenExpiresIn: undefined,
    deployTokenLastUpdated: undefined,
  };
  await clearCmTokens(envName);
  await clearDeployToken(envName);
  rootConfigFile.config.envProfiles = envProfiles;
  writeRootConfigurationFile(configPath, rootConfigFile.config);
  logger.info(`Cleared stored tokens for environment '${envName}'.`, "green");
};
