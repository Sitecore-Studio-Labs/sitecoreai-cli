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

import path from "node:path";
import {
  readRootConfigurationFile,
  resolveActiveEnvironment,
  writeRootConfigurationFile,
} from "@/config/root-config";
import { getCmClientSecret, getDeployToken, setCmClientSecret } from "@/shared/keychain";
import { sleep } from "@/shared/concurrency";
import {
  buildScaiClientDescription,
  buildScaiClientName,
  deleteClient,
  listEnvironmentClients,
  mintCmClient,
} from "@/deploy/api";
import { inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError, toScaiError } from "@/shared/errors";
import { authorizeOperation } from "@/policy";
import { requestClientCredentialsToken } from "@/auth";
import type { SitecoreApiClientOptions } from "@/auth";
import type { CommonOptions } from "@/shared/cli-options";
import type { Logger } from "@/shared/logger";
import packageJson from "../../package.json";

/** Timing knobs for {@link waitForClientActivation} — overridable for tests. */
export interface ClientActivationOptions {
  /** Give up after this long (default 120_000 ms). */
  timeoutMs?: number;
  /** First backoff delay (default 2_000 ms). */
  initialDelayMs?: number;
  /** Backoff ceiling (default 15_000 ms). */
  maxDelayMs?: number;
}

/**
 * Poll a client-credentials grant until a freshly-minted automation
 * client activates.
 *
 * A just-created Sitecore automation client is not immediately usable —
 * the identity provider takes up to ~2 min to propagate it, and the
 * grant fails until it has. Returns `true` once a token is obtained,
 * `false` if the window elapses first (the client is minted regardless
 * and usually becomes usable shortly after).
 */
export const waitForClientActivation = async (
  credential: SitecoreApiClientOptions,
  logger: Logger,
  options: ClientActivationOptions = {}
): Promise<boolean> => {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  let delayMs = options.initialDelayMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await requestClientCredentialsToken(credential);
      if (attempt > 1) {
        logger.info("  Client is active.", "green");
      }
      return true;
    } catch (error) {
      if (Date.now() + delayMs >= deadline) {
        logger.warn(
          `The minted client did not activate within ${Math.round(timeoutMs / 1000)}s. ` +
            "It usually becomes usable within a minute or two — retry your command then."
        );
        return false;
      }
      if (attempt === 1) {
        logger.info("  Waiting for the new client to activate…");
      }
      logger.verbose(
        `Client not active yet (attempt ${attempt}): ${toScaiError(error).message}. ` +
          `Retrying in ${Math.round(delayMs / 1000)}s.`
      );
      await sleep(delayMs);
      delayMs = Math.min(Math.round(delayMs * 1.5), maxDelayMs);
    }
  }
};

export type SetupEnvOptions = CommonOptions & {
  environmentName?: string;
  /** Preview the action without minting or deleting anything. */
  whatIf?: boolean;
  /** Delete and re-mint the client even if one is already provisioned. */
  rotate?: boolean;
};

/** Resolve the deploy token for CM-client provisioning, or throw. */
const resolveCmDeployToken = async (
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
        hint: `Run \`scai setup login -n ${envName}\` first — minting a CM client needs a token with the xmclouddeploy.clients:manage scope.`,
      }
    );
  }
  return deployToken;
};

/** List the env's existing CM client id (by stable name), mapping list failures. */
const findExistingCmClientId = async (params: {
  deployClient: { accessToken: string };
  organizationId: string;
  clientName: string;
  envName: string;
}): Promise<string | undefined> => {
  const { deployClient, organizationId, clientName, envName } = params;
  try {
    const listed = await listEnvironmentClients(deployClient, organizationId);
    return (listed.items ?? []).find((client) => client.name === clientName)?.id;
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
};

/** Emit the "already provisioned, nothing to do" result. Returns true when it handled the run. */
const reportCmAlreadyProvisioned = (params: {
  alreadyProvisioned: boolean;
  rotate: boolean | undefined;
  logger: Logger;
  envName: string;
  clientName: string;
}): boolean => {
  const { alreadyProvisioned, rotate, logger, envName, clientName } = params;
  if (!(alreadyProvisioned && !rotate)) {
    return false;
  }
  if (logger.isJson()) {
    logger.json({ environment: envName, client: clientName, action: "none", provisioned: true });
    return true;
  }
  logger.info(`Environment '${envName}' already has its CM client (${clientName}).`, "green");
  logger.info("  Nothing to do. Pass --rotate to delete and re-mint.");
  return true;
};

/** Emit the `--what-if` preview. Returns true when it handled the run. */
const reportCmWhatIf = (params: {
  whatIf: boolean | undefined;
  replaceExisting: boolean;
  logger: Logger;
  envName: string;
  clientName: string;
}): boolean => {
  const { whatIf, replaceExisting, logger, envName, clientName } = params;
  if (!whatIf) {
    return false;
  }
  const verb = replaceExisting ? "delete the existing client and re-mint" : "mint";
  if (logger.isJson()) {
    logger.json({
      environment: envName,
      client: clientName,
      action: replaceExisting ? "replace" : "mint",
      whatIf: true,
    });
    return true;
  }
  logger.info(`[what-if] Would ${verb} CM client '${clientName}' for '${envName}'.`);
  return true;
};

export const runSetupEnv = async (options: SetupEnvOptions): Promise<void> => {
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

  const { organizationId, projectId, environmentId } = env;
  if (!organizationId || !projectId || !environmentId) {
    throw inputError(
      `Environment '${envName}' is missing organizationId, projectId, or environmentId.`,
      "All three are required to mint an environment-scoped CM client. Run `scai setup init`."
    );
  }

  const deployToken = await resolveCmDeployToken(envName, env);

  const deployClient = { accessToken: deployToken };
  const clientName = buildScaiClientName("cm", envName);

  // Read-side reconciliation — safe to run even under --what-if. A
  // provisioned client means both halves are present: the non-secret
  // metadata in the config (`automationClient`) AND the secret in the
  // keychain. Either alone is incomplete.
  const storedSecret = await getCmClientSecret(envName);
  const stored = Boolean(env.automationClient?.clientId) && Boolean(storedSecret);
  const existingId = await findExistingCmClientId({
    deployClient,
    organizationId,
    clientName,
    envName,
  });

  const alreadyProvisioned = Boolean(stored) && Boolean(existingId);
  if (
    reportCmAlreadyProvisioned({
      alreadyProvisioned,
      rotate: options.rotate,
      logger,
      envName,
      clientName,
    })
  ) {
    return;
  }

  // An existing server-side client with no keychain secret is an
  // orphan — the secret is unrecoverable, so it must be replaced.
  const replaceExisting = Boolean(existingId) && (!stored || Boolean(options.rotate));

  if (reportCmWhatIf({ whatIf: options.whatIf, replaceExisting, logger, envName, clientName })) {
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

  if (!logger.isJson()) {
    logger.info(`Minted CM client '${clientName}' for '${envName}'.`, "green");
    logger.info(`  clientId: ${minted.clientId}`);
    if (!persisted) {
      logger.warn(
        "Keychain unavailable — the client secret was NOT persisted. The minted client is unusable; re-run when the keychain is available."
      );
    }
  }

  // A freshly-minted client is not usable until the identity provider
  // activates it (~1-2 min), during which a client-credentials grant
  // still fails. Poll so the command does not report success on a client
  // an immediate follow-up call would be rejected by — the race an agent
  // hits when it uses the credential right after the mint.
  const active = env.authority
    ? await waitForClientActivation(
        {
          authority: env.authority,
          clientId: minted.clientId,
          clientSecret: minted.clientSecret,
          audience: env.audience,
        },
        logger
      )
    : true;

  if (logger.isJson()) {
    logger.json({
      environment: envName,
      client: clientName,
      action: replaceExisting ? "replace" : "mint",
      clientId: minted.clientId,
      persisted,
      active,
    });
  }
};
