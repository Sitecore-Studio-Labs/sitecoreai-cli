/**
 * `scai setup client create --org <env>` — provision the organization-
 * scoped automation client for the org behind one environment.
 *
 * Mirrors `runSetupEnv` (the env-scoped CM client) but mints the
 * org-scoped `deploy` client type: it carries only a name (no project /
 * environment binding) and is stored in the keychain keyed by
 * `organizationId` — one per org, shared by every env profile in it.
 *
 * The flow is list-or-mint, keyed on the stable `scai-deploy` client
 * name so re-runs are idempotent.
 */

import {
  readRootConfiguration,
  readRootConfigurationFile,
  writeRootConfigurationFile,
} from "@/config/root-config";
import { getDeployToken, getOrgClientSecret, setOrgClientSecret } from "@/shared/keychain";
import {
  buildScaiClientDescription,
  buildScaiClientName,
  deleteClient,
  listOrganizationClients,
  mintDeployClient,
} from "@/deploy/api";
import { inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError, toScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";
import packageJson from "../../../../package.json";

export type SetupOrgClientOptions = CommonOptions & {
  environmentName?: string;
  /** Preview the action without minting or deleting anything. */
  whatIf?: boolean;
  /** Delete and re-mint the client even if one is already provisioned. */
  rotate?: boolean;
};

export const runSetupOrgClient = async (options: SetupOrgClientOptions): Promise<void> => {
  const logger = toLogger(options);
  const envName = options.environmentName;
  if (!envName) {
    throw inputError(
      "Environment name is required.",
      "Pass an environment name to resolve the organization: `scai setup client create --org <name>`."
    );
  }

  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, envName);
  const env = root.environments[envName];
  if (!env) {
    throw inputError(
      `Environment '${envName}' is not configured.`,
      "Run `scai setup init` to add it."
    );
  }

  const { organizationId } = env;
  if (!organizationId) {
    throw inputError(
      `Environment '${envName}' has no organizationId.`,
      "Set organizationId on the env profile, or run `scai setup init`."
    );
  }

  const deployToken =
    (await getDeployToken(envName)) ?? env.deployToken ?? process.env.SITECOREAI_DEPLOY_TOKEN;
  if (!deployToken) {
    throw createScaiError(
      `No deploy token is available for environment '${envName}'.`,
      "AUTH_REQUIRED",
      {
        hint: `Run \`scai setup login -n ${envName}\` first — minting a client needs a token with the xmclouddeploy.clients:manage scope.`,
      }
    );
  }

  const deployClient = { accessToken: deployToken };
  const clientName = buildScaiClientName("deploy");

  // Read-side reconciliation — safe to run even under --what-if. A
  // provisioned client means both halves are present: the non-secret
  // metadata in the config (`orgClients[orgId]`) AND the secret in the
  // keychain. Either alone is incomplete.
  const rootFile = readRootConfigurationFile(configPath);
  const storedSecret = await getOrgClientSecret(organizationId);
  const stored =
    Boolean(rootFile.config.orgClients?.[organizationId]?.clientId) && Boolean(storedSecret);
  let existingId: string | undefined;
  try {
    const listed = await listOrganizationClients(deployClient, organizationId);
    existingId = (listed.items ?? []).find((client) => client.name === clientName)?.id;
  } catch (error) {
    const scaiError = toScaiError(error);
    throw createScaiError(
      `Could not list organization clients for organization '${organizationId}'.`,
      "DEPLOY_FAILED",
      {
        hint: `The deploy token may lack the xmclouddeploy.clients:manage scope. Re-run \`scai setup login -n ${envName}\`. Underlying error: ${scaiError.message}`,
      }
    );
  }

  const alreadyProvisioned = Boolean(stored) && Boolean(existingId);
  if (alreadyProvisioned && !options.rotate) {
    if (logger.isJson()) {
      logger.json({
        organization: organizationId,
        client: clientName,
        action: "none",
        provisioned: true,
      });
      return;
    }
    logger.info(
      `Organization '${organizationId}' already has its automation client (${clientName}).`,
      "green"
    );
    logger.info("  Nothing to do. Pass --rotate to delete and re-mint.");
    return;
  }

  // An existing server-side client with no keychain secret is an orphan —
  // the secret is unrecoverable, so it must be replaced.
  const replaceExisting = Boolean(existingId) && (!stored || Boolean(options.rotate));

  if (options.whatIf) {
    const verb = replaceExisting ? "delete the existing client and re-mint" : "mint";
    if (logger.isJson()) {
      logger.json({
        organization: organizationId,
        client: clientName,
        action: replaceExisting ? "replace" : "mint",
        whatIf: true,
      });
      return;
    }
    logger.info(
      `[what-if] Would ${verb} org client '${clientName}' for organization '${organizationId}'.`
    );
    return;
  }

  if (replaceExisting && existingId) {
    const reason = options.rotate ? "rotating" : "orphaned — secret not in keychain";
    logger.info(`Removing the existing '${clientName}' client (${reason})…`);
    await deleteClient(deployClient, existingId, organizationId);
  }

  const minted = await mintDeployClient(
    deployClient,
    {
      name: clientName,
      description: buildScaiClientDescription("deploy", {
        surface: "CLI",
        version: packageJson.version,
      }),
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
  // (clientId, name, mintedAt) goes into the `orgClients[orgId]` block
  // in the config file — a readable inventory of what's configured. See
  // docs/credentials.md.
  const persisted = await setOrgClientSecret(organizationId, minted.clientSecret);

  const rootConfigFile = readRootConfigurationFile(configPath);
  const orgClients = rootConfigFile.config.orgClients ?? {};
  orgClients[organizationId] = {
    clientId: minted.clientId,
    name: clientName,
    mintedAt: new Date().toISOString(),
  };
  rootConfigFile.config.orgClients = orgClients;
  writeRootConfigurationFile(configPath, rootConfigFile.config);

  if (logger.isJson()) {
    logger.json({
      organization: organizationId,
      client: clientName,
      action: replaceExisting ? "replace" : "mint",
      clientId: minted.clientId,
      persisted,
    });
    return;
  }

  logger.info(
    `Minted org automation client '${clientName}' for organization '${organizationId}'.`,
    "green"
  );
  logger.info(`  clientId: ${minted.clientId}`);
  if (!persisted) {
    logger.warn(
      "Keychain unavailable — the client secret was NOT persisted. The minted client is unusable; re-run when the keychain is available."
    );
  }
};
