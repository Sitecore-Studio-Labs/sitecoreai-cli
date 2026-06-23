/**
 * `scai setup bootstrap [env]` — one guided flow from a configured env profile
 * to a pushable recipe set. It composes the steps an operator otherwise runs
 * (and discovers one-error-at-a-time) by hand:
 *
 *   1. Workspace policy   — enroll + permit minting + raise the ceiling to
 *                           `destructive` (consent-gated; these are deny-by-default
 *                           safety guardrails, so we ask before flipping them).
 *   2. Authenticate       — device login to mint the deploy token.
 *   3. CM automation client — mint the env-scoped client the Authoring API needs.
 *   4. Site identity      — pick the SXA site (now that discovery can auth),
 *                           writing `site` + `siteCollection` so recipeRoots derive.
 *   5. Push the recipes   — optional, consent-gated.
 *
 * Every step is idempotent: re-running bootstrap re-grants (no-op), re-mints
 * (skips if present), and re-pushes (zero mutations) — so it doubles as a
 * "fix my setup" command. Prerequisite: the env profile must exist
 * (`scai setup init`); bootstrap errors with that hint if it doesn't.
 */

import {
  readRootConfigurationFile,
  resolveActiveEnvironment,
  writeRootConfigurationFile,
} from "@/config/root-config";
import type { CommonOptions } from "@/shared/cli-options";
import type { EnvironmentConfiguration } from "@/config/types";
import { enrollEnvironment, setEnvironmentFlags } from "@/policy";
import type { RiskTier } from "@/policy";
import { runRecipePush } from "@/recipe/tasks/push";
import { runRecipePruneDefaults } from "@/recipe/tasks/prune-defaults";
import { assertInteractive, promptConfirm } from "@/shared/prompt";
import { toLogger } from "../shared";
import { runDeployToken } from "./deploy-token";
import { resolveSiteIdentity } from "./init";
import { runSetupEnv } from "./setup-env";

export type BootstrapOptions = CommonOptions & {
  environmentName?: string;
  /** Answer "yes" to every consent prompt (policy grants, login, push). */
  yes?: boolean;
  /** Skip the final recipe push. */
  skipPush?: boolean;
  /** After pushing, prune the SXA Headless OOTB default folders. */
  pruneDefaults?: boolean;
};

export const runBootstrap = async (options: BootstrapOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();

  // Require a configured profile — bootstrap provisions *around* it, it doesn't
  // create it (that's `setup init`, one command, with its own deploy lookup).
  const { envName, env } = resolveActiveEnvironment(configPath, options.environmentName);

  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && process.env.SITECOREAI_NON_INTERACTIVE !== "1";
  if (!isInteractive && !options.yes) {
    assertInteractive(
      "bootstrap needs a TTY for its consent prompts. Pass --yes to accept them all.",
      "Pass --yes to run non-interactively."
    );
  }
  const confirm = async (question: string): Promise<boolean> =>
    options.yes ? true : promptConfirm(question, true);

  logger.info(`Bootstrapping '${envName}' — policy, auth, client, site, recipes.`, "cyan");

  // 1. Workspace policy — enroll + mint + destructive ceiling (idempotent).
  if (
    await confirm(
      `Grant workspace policy for '${envName}' (enroll + permit minting + raise ceiling to 'destructive')?`
    )
  ) {
    enrollEnvironment({ envName, environment: env, via: "policy-allow" });
    setEnvironmentFlags(envName, { mintCredentials: true, ceiling: "destructive" as RiskTier });
    logger.info("  ✓ policy: enrolled, minting allowed, ceiling=destructive.", "green");
  } else {
    logger.warn("  Skipped policy grants — minting and push may be blocked.");
  }

  // 2. Authenticate — device login mints the deploy token the next steps use.
  if (await confirm("Authenticate now (opens a browser device-login)?")) {
    await runDeployToken({ environmentName: envName, config: options.config });
  }

  // 3. Mint the env-scoped CM automation client the Authoring API mints tokens from.
  logger.info("  Minting the CM automation client…");
  await runSetupEnv({ environmentName: envName, config: options.config });

  // 4. Site identity — pick the SXA site (discovery can authenticate now), so
  //    recipeRoots derive from `site` + `siteCollection`.
  const file = readRootConfigurationFile(configPath);
  const profiles = file.config.envProfiles ?? {};
  const updated: EnvironmentConfiguration = { ...(profiles[envName] ?? {}) };
  await resolveSiteIdentity({
    options: { environmentName: envName, config: options.config },
    updated,
    envName,
    runWizard: isInteractive,
    logger,
  });
  file.config.envProfiles = { ...profiles, [envName]: updated };
  writeRootConfigurationFile(configPath, file.config);

  // 5. Push the recipe set (optional).
  if (!options.skipPush && (await confirm("Push the recipe set to Sitecore now?"))) {
    await runRecipePush({ environmentName: envName, allowWrite: true, config: options.config });
  }

  // 6. Prune the SXA Headless OOTB default folders (opt-in, destructive).
  if (
    options.pruneDefaults &&
    (await confirm("Prune the SXA OOTB default folders (Media, Navigation, Promo, …)?"))
  ) {
    await runRecipePruneDefaults({
      environmentName: envName,
      allowWrite: true,
      config: options.config,
    });
  }

  logger.info(
    `'${envName}' is ready. Run 'scai provision recipe push -n ${envName}' anytime.`,
    "green"
  );
  if (logger.isJson()) {
    logger.json({
      command: "setup.bootstrap",
      envName,
      site: updated.site,
      siteCollection: updated.siteCollection,
    });
  }
};
