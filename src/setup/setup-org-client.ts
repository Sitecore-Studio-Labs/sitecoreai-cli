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

import path from "node:path";
import {
  readRootConfigurationFile,
  resolveActiveEnvironment,
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
import { authorizeOperation } from "@/policy";
import type { CommonOptions } from "@/shared/cli-options";
import packageJson from "../../package.json";

export type SetupOrgClientOptions = CommonOptions & {
  environmentName?: string;
  /** Preview the action without minting or deleting anything. */
  whatIf?: boolean;
  /** Delete and re-mint the client even if one is already provisioned. */
  rotate?: boolean;
};

/** Resolve the deploy token for org-client provisioning, or throw. */
const resolveOrgDeployToken = async (
  envName: string,
  env: { deployToken?: string }
): Promise<string> => {
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
  return deployToken;
};

/** List the org's existing automation client id (by stable name), mapping list failures. */
const findExistingOrgClientId = async (params: {
  deployClient: { accessToken: string };
  organizationId: string;
  clientName: string;
  envName: string;
}): Promise<string | undefined> => {
  const { deployClient, organizationId, clientName, envName } = params;
  try {
    const listed = await listOrganizationClients(deployClient, organizationId);
    return (listed.items ?? []).find((client) => client.name === clientName)?.id;
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
};

/** Emit the "already provisioned, nothing to do" result. Returns true when it handled the run. */
const reportAlreadyProvisioned = (params: {
  alreadyProvisioned: boolean;
  rotate: boolean | undefined;
  logger: ReturnType<typeof toLogger>;
  organizationId: string;
  clientName: string;
}): boolean => {
  const { alreadyProvisioned, rotate, logger, organizationId, clientName } = params;
  if (!(alreadyProvisioned && !rotate)) {
    return false;
  }
  if (logger.isJson()) {
    logger.json({
      organization: organizationId,
      client: clientName,
      action: "none",
      provisioned: true,
    });
    return true;
  }
  logger.info(
    `Organization '${organizationId}' already has its automation client (${clientName}).`,
    "green"
  );
  logger.info("  Nothing to do. Pass --rotate to delete and re-mint.");
  return true;
};

/** Emit the `--what-if` preview. Returns true when it handled the run. */
const reportWhatIf = (params: {
  whatIf: boolean | undefined;
  replaceExisting: boolean;
  logger: ReturnType<typeof toLogger>;
  organizationId: string;
  clientName: string;
}): boolean => {
  const { whatIf, replaceExisting, logger, organizationId, clientName } = params;
  if (!whatIf) {
    return false;
  }
  const verb = replaceExisting ? "delete the existing client and re-mint" : "mint";
  if (logger.isJson()) {
    logger.json({
      organization: organizationId,
      client: clientName,
      action: replaceExisting ? "replace" : "mint",
      whatIf: true,
    });
    return true;
  }
  logger.info(
    `[what-if] Would ${verb} org client '${clientName}' for organization '${organizationId}'.`
  );
  return true;
};

export const runSetupOrgClient = async (options: SetupOrgClientOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const { envName, env, root } = resolveActiveEnvironment(configPath, options.environmentName);

  // Phase 2 mint gate — minting an automation client requires an
  // interactive human operator on a mint-eligible environment. A no-op
  // in unmanaged mode. See docs/policy-and-guardrails.md.
  authorizeOperation({
    envName,
    configRootDir: root.physicalPath ? path.dirname(root.physicalPath) : undefined,
    tier: "mint",
  });

  const { organizationId } = env;
  if (!organizationId) {
    throw inputError(
      `Environment '${envName}' has no organizationId.`,
      "Set organizationId on the env profile, or run `scai setup init`."
    );
  }

  const deployToken = await resolveOrgDeployToken(envName, env);

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
  const existingId = await findExistingOrgClientId({
    deployClient,
    organizationId,
    clientName,
    envName,
  });

  const alreadyProvisioned = Boolean(stored) && Boolean(existingId);
  if (
    reportAlreadyProvisioned({
      alreadyProvisioned,
      rotate: options.rotate,
      logger,
      organizationId,
      clientName,
    })
  ) {
    return;
  }

  // An existing server-side client with no keychain secret is an orphan —
  // the secret is unrecoverable, so it must be replaced.
  const replaceExisting = Boolean(existingId) && (!stored || Boolean(options.rotate));

  if (
    reportWhatIf({ whatIf: options.whatIf, replaceExisting, logger, organizationId, clientName })
  ) {
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
