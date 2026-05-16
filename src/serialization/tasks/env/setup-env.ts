/**
 * `scai setup env <name>` — provision the environment-scoped CM
 * automation client for one environment.
 *
 * The flow is list-or-mint, keyed on the stable `scai-cm-<env>` client
 * name so re-runs are idempotent:
 *
 *   1. Resolve the env profile — needs organizationId + projectId +
 *      environmentId.
 *   2. Use the env's deploy token (it carries `xmclouddeploy.clients:manage`,
 *      requested at `scai setup login`) as the clients-API credential.
 *   3. List the org's environment clients; look for `scai-cm-<env>`.
 *   4. Reconcile:
 *        - keychain has the secret AND the server lists it  → done.
 *        - server lists it but the keychain has no secret    → orphan
 *          (lost secret — unrecoverable); delete it, then mint fresh.
 *        - `--rotate`                                        → delete +
 *          re-mint regardless.
 *        - neither                                           → mint.
 *   5. Persist the minted client: its non-secret metadata (clientId,
 *      name, mintedAt) into the env profile's `automationClient` block in
 *      the config file, and only the secret into the OS keychain.
 */

import {
  readRootConfiguration,
  readRootConfigurationFile,
  writeRootConfigurationFile,
} from "@/config/root-config";
import { getCmClientSecret, getDeployToken, setCmClientSecret } from "@/shared/keychain";
import {
  buildScaiClientDescription,
  buildScaiClientName,
  deleteClient,
  listEnvironmentClients,
  mintCmClient,
} from "@/deploy/api";
import { inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError, toScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";
import packageJson from "../../../../package.json";

export type SetupEnvOptions = CommonOptions & {
  environmentName?: string;
  /** Preview the action without minting or deleting anything. */
  whatIf?: boolean;
  /** Delete and re-mint the client even if one is already provisioned. */
  rotate?: boolean;
};

export const runSetupEnv = async (options: SetupEnvOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const envName =
    options.environmentName ?? readRootConfigurationFile(configPath).config.defaultEnvProfile;
  if (!envName) {
    throw inputError(
      "No environment specified and no defaultEnvProfile is set.",
      "Pass an environment name: `scai setup client create <name>`."
    );
  }

  const root = readRootConfiguration(configPath, envName);
  const env = root.environments[envName];
  if (!env) {
    throw inputError(
      `Environment '${envName}' is not configured.`,
      "Run `scai setup init` to add it."
    );
  }

  const { organizationId, projectId, environmentId } = env;
  if (!organizationId || !projectId || !environmentId) {
    throw inputError(
      `Environment '${envName}' is missing organizationId, projectId, or environmentId.`,
      "All three are required to mint an environment-scoped CM client. Run `scai setup init`."
    );
  }

  const deployToken =
    (await getDeployToken(envName)) ?? env.deployToken ?? process.env.SITECOREAI_DEPLOY_TOKEN;
  if (!deployToken) {
    throw createScaiError(
      `No deploy token is available for environment '${envName}'.`,
      "AUTH_REQUIRED",
      {
        hint: `Run \`scai setup login -n ${envName}\` first — minting a CM client needs a token with the xmclouddeploy.clients:manage scope.`,
      }
    );
  }

  const deployClient = { accessToken: deployToken };
  const clientName = buildScaiClientName("cm", envName);

  // Read-side reconciliation — safe to run even under --what-if. A
  // provisioned client means both halves are present: the non-secret
  // metadata in the config (`automationClient`) AND the secret in the
  // keychain. Either alone is incomplete.
  const storedSecret = await getCmClientSecret(envName);
  const stored = Boolean(env.automationClient?.clientId) && Boolean(storedSecret);
  let existingId: string | undefined;
  try {
    const listed = await listEnvironmentClients(deployClient, organizationId);
    existingId = (listed.items ?? []).find((client) => client.name === clientName)?.id;
  } catch (error) {
    const scaiError = toScaiError(error);
    throw createScaiError(
      `Could not list environment clients for organization '${organizationId}'.`,
      "DEPLOY_FAILED",
      {
        hint: `The deploy token may lack the xmclouddeploy.clients:manage scope. Re-run \`scai setup login -n ${envName}\`. Underlying error: ${scaiError.message}`,
      }
    );
  }

  const alreadyProvisioned = Boolean(stored) && Boolean(existingId);
  if (alreadyProvisioned && !options.rotate) {
    if (logger.isJson()) {
      logger.json({ environment: envName, client: clientName, action: "none", provisioned: true });
      return;
    }
    logger.info(`Environment '${envName}' already has its CM client (${clientName}).`, "green");
    logger.info("  Nothing to do. Pass --rotate to delete and re-mint.");
    return;
  }

  // An existing server-side client with no keychain secret is an
  // orphan — the secret is unrecoverable, so it must be replaced.
  const replaceExisting = Boolean(existingId) && (!stored || Boolean(options.rotate));

  if (options.whatIf) {
    const verb = replaceExisting ? "delete the existing client and re-mint" : "mint";
    if (logger.isJson()) {
      logger.json({
        environment: envName,
        client: clientName,
        action: replaceExisting ? "replace" : "mint",
        whatIf: true,
      });
      return;
    }
    logger.info(`[what-if] Would ${verb} CM client '${clientName}' for '${envName}'.`);
    return;
  }

  if (replaceExisting && existingId) {
    const reason = options.rotate ? "rotating" : "orphaned — secret not in keychain";
    logger.info(`Removing the existing '${clientName}' client (${reason})…`);
    await deleteClient(deployClient, existingId, organizationId);
  }

  const minted = await mintCmClient(
    deployClient,
    {
      name: clientName,
      description: buildScaiClientDescription("cm", {
        surface: "CLI",
        version: packageJson.version,
        envName,
      }),
      projectId,
      environmentId,
    },
    organizationId
  );
  if (!minted.clientId || !minted.clientSecret) {
    throw createScaiError(
      "The clients API did not return a clientId/clientSecret.",
      "DEPLOY_FAILED",
      { hint: "Re-run the command; if it persists, mint the client in the Cloud Portal." }
    );
  }

  // The keychain holds only the secret; the non-secret metadata
  // (clientId, name, mintedAt) goes into the env profile's
  // `automationClient` block in the config file — a readable inventory
  // of what's configured. See docs/credentials.md.
  const persisted = await setCmClientSecret(envName, minted.clientSecret);

  const rootConfigFile = readRootConfigurationFile(configPath);
  const envProfiles = rootConfigFile.config.envProfiles ?? {};
  envProfiles[envName] = {
    ...(envProfiles[envName] ?? {}),
    automationClient: {
      clientId: minted.clientId,
      name: clientName,
      mintedAt: new Date().toISOString(),
    },
  };
  rootConfigFile.config.envProfiles = envProfiles;
  writeRootConfigurationFile(configPath, rootConfigFile.config);

  if (logger.isJson()) {
    logger.json({
      environment: envName,
      client: clientName,
      action: replaceExisting ? "replace" : "mint",
      clientId: minted.clientId,
      persisted,
    });
    return;
  }

  logger.info(`Minted CM client '${clientName}' for '${envName}'.`, "green");
  logger.info(`  clientId: ${minted.clientId}`);
  if (!persisted) {
    logger.warn(
      "Keychain unavailable — the client secret was NOT persisted. The minted client is unusable; re-run when the keychain is available."
    );
  }
};
