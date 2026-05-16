/**
 * `scai setup clients [name]` — list, or with `--delete <id>` remove,
 * the automation clients (credentials) in an environment's
 * organization.
 *
 * The Deploy clients API is organization-scoped, so this covers every
 * client in the org the named environment belongs to — both the
 * environment-scoped clients (`cm`, `edge`, `ehbuild`) and the
 * organization-scoped `deploy` clients. scai-minted clients (the
 * `scai-*` naming convention) are flagged so an operator can tell
 * what scai provisioned apart from anything created by hand.
 *
 * Pair with `scai setup env` (mint) and `scai setup status` (the
 * yes/no credential matrix).
 */

import { readRootConfiguration, readRootConfigurationFile } from "@/config/root-config";
import { clearCmClientCredential, getDeployToken } from "@/shared/keychain";
import {
  buildScaiClientName,
  deleteClient,
  isScaiManagedClient,
  listEnvironmentClients,
  listOrganizationClients,
} from "@/deploy/api";
import { confirmDestructive, inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import type { Logger } from "@/shared/logger";
import type { CommonOptions } from "@/shared/cli-options";

export type SetupClientsOptions = CommonOptions & {
  environmentName?: string;
  /** When set, delete the client with this id instead of listing. */
  delete?: string;
  /** Skip the delete confirmation prompt. */
  force?: boolean;
};

const renderRow = (
  logger: Logger,
  name: string | undefined,
  id: string | undefined,
  clientId: string | undefined,
  scope: string
): void => {
  const tag = isScaiManagedClient(name) ? "[scai]" : "      ";
  logger.info(`  ${tag} ${name ?? "(unnamed)"}  ${id ?? "?"}${scope}`);
  if (clientId) {
    logger.info(`         clientId: ${clientId}`);
  }
};

export const runSetupClients = async (options: SetupClientsOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const envName = options.environmentName ?? rootFile.config.defaultEnvProfile;
  if (!envName) {
    throw inputError(
      "No environment specified and no defaultEnvProfile is set.",
      "Pass an environment name: `scai setup clients <name>`."
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

  const organizationId = env.organizationId;
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
      { hint: `Run \`scai setup login -n ${envName}\` first.` }
    );
  }

  const deployClient = { accessToken: deployToken };
  const environmentClients =
    (await listEnvironmentClients(deployClient, organizationId)).items ?? [];
  const organizationClients =
    (await listOrganizationClients(deployClient, organizationId)).items ?? [];

  // --- delete mode -------------------------------------------------------
  if (options.delete) {
    const targetId = options.delete;
    const match = [...environmentClients, ...organizationClients].find((c) => c.id === targetId);
    if (!match) {
      throw inputError(
        `No client with id '${targetId}' in organization ${organizationId}.`,
        "Run `scai setup clients` to see the available client ids."
      );
    }
    const scaiManaged = isScaiManagedClient(match.name);
    const caveat = scaiManaged
      ? ""
      : " This client was NOT created by scai — deleting it may break another integration.";
    const proceed = await confirmDestructive(
      `Delete client '${match.name ?? "(unnamed)"}' (${targetId})?${caveat}`,
      options.force
    );
    if (!proceed) {
      logger.info("Aborted.");
      return;
    }
    await deleteClient(deployClient, targetId, organizationId);
    // If we just deleted this environment's scai-minted CM client, drop
    // the now-dead secret from the keychain so `setup status` is honest.
    if (match.name === buildScaiClientName("cm", envName)) {
      await clearCmClientCredential(envName);
    }
    if (logger.isJson()) {
      logger.json({ deleted: targetId, name: match.name ?? null, organizationId });
      return;
    }
    logger.info(`Deleted client '${match.name ?? targetId}' (${targetId}).`, "green");
    return;
  }

  // --- list mode ---------------------------------------------------------
  if (logger.isJson()) {
    logger.json({ environment: envName, organizationId, environmentClients, organizationClients });
    return;
  }

  logger.info(
    `Automation clients in organization ${organizationId} (via env '${envName}')`,
    "cyan"
  );

  logger.info(`\nEnvironment-scoped (${environmentClients.length}):`);
  if (environmentClients.length === 0) {
    logger.info("  (none)");
  }
  for (const client of environmentClients) {
    const scope = client.environmentName
      ? `  → ${client.projectName ?? "?"} / ${client.environmentName}`
      : "";
    renderRow(logger, client.name, client.id, client.clientId, scope);
  }

  logger.info(`\nOrganization-scoped (${organizationClients.length}):`);
  if (organizationClients.length === 0) {
    logger.info("  (none)");
  }
  for (const client of organizationClients) {
    renderRow(logger, client.name, client.id, client.clientId, "");
  }

  logger.info("\n[scai] = minted by scai (scai setup env). Others were created elsewhere.");
};
