/**
 * `scai setup bootstrap [env]` — one guided flow from (optionally) nothing to a
 * working head app. It composes the steps an operator otherwise runs (and
 * discovers one-error-at-a-time) by hand:
 *
 *   0. Init (conditional)  — if no profile exists for the env, run `setup init`
 *                            first. `init` stays a thin standalone command; this
 *                            is just so bootstrap can start from zero.
 *   1. Workspace policy    — enroll + permit minting + raise the ceiling to
 *                            `destructive` (consent-gated; these are deny-by-default
 *                            safety guardrails, so we ask before flipping them).
 *   2. Authenticate        — device login to mint the deploy token.
 *   3. CM automation client — mint the env-scoped client the Authoring API needs.
 *   4. Site identity       — pick the SXA site (now that discovery can auth),
 *                            writing `site` + `siteCollection` so recipeRoots derive.
 *   5. Repo assets         — generate `.env.local` + `xmcloud.build.json` for the
 *                            head app, using the just-picked site. On by default
 *                            in a head-app repo; `--skip-assets` / `--assets` override.
 *   6. Push the recipes    — optional, consent-gated (`--skip-push` to provision only).
 *   7. Prune (opt-in)      — `--prune-defaults` removes the SXA OOTB default folders.
 *
 * Every step is idempotent: re-running bootstrap re-grants (no-op), re-mints
 * (skips if present), re-writes the merged repo assets, and re-pushes (zero
 * mutations) — so it doubles as a "fix my setup" command.
 */

import fs from "node:fs";
import path from "node:path";
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
import { runDeployEnvFile } from "@/deploy/tasks/env-file";
import { runDeployBuildConfig } from "@/deploy/tasks/build-config";
import { assertInteractive, promptConfirm } from "@/shared/prompt";
import { toLogger } from "../shared";
import { runDeployToken } from "./deploy-token";
import { resolveSiteIdentity, runInit } from "./init";
import { runSetupEnv } from "./setup-env";

export type BootstrapOptions = CommonOptions & {
  environmentName?: string;
  /** Answer "yes" to every consent prompt (policy grants, login, assets, push). */
  yes?: boolean;
  /** Force-generate the repo assets (.env.local + xmcloud.build.json) even outside a head-app repo. */
  assets?: boolean;
  /** Skip the repo-assets step. */
  skipAssets?: boolean;
  /** Rendering-host key for xmcloud.build.json (defaults to `<site>-editing-host`). */
  renderingHost?: string;
  /** Skip the recipe push. */
  skipPush?: boolean;
  /** After pushing, prune the SXA Headless OOTB default folders. */
  pruneDefaults?: boolean;
};

/**
 * Does `dir` look like a Content SDK head app? Used to decide whether the
 * repo-assets step runs by default. Cheap signal checks, never throws.
 */
export const isHeadAppRepo = (dir: string = process.cwd()): boolean => {
  try {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (Object.keys(deps).some((dep) => dep.startsWith("@sitecore-content-sdk/"))) return true;
    }
  } catch {
    // Unreadable/malformed package.json → fall through to file-based signals.
  }
  return (
    fs.existsSync(path.join(dir, "xmcloud.build.json")) ||
    fs.existsSync(path.join(dir, "sitecore.config.ts"))
  );
};

export const runBootstrap = async (options: BootstrapOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();

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

  // 0. Init (conditional) — bootstrap can start from zero. If the target profile
  //    isn't configured yet, run `setup init` first (it stays a standalone command).
  const existingProfiles = readRootConfigurationFile(configPath).config.envProfiles ?? {};
  const profileExists = options.environmentName
    ? Boolean(existingProfiles[options.environmentName])
    : Object.keys(existingProfiles).length > 0;
  if (!profileExists) {
    logger.info(
      options.environmentName
        ? `No '${options.environmentName}' profile yet — running 'setup init' first.`
        : "No environment profile yet — running 'setup init' first.",
      "cyan"
    );
    await runInit({
      environmentName: options.environmentName,
      wizard: isInteractive,
      config: options.config,
    });
  }

  const { envName, env } = resolveActiveEnvironment(configPath, options.environmentName);

  logger.info(`Bootstrapping '${envName}' — policy, auth, client, site, assets, recipes.`, "cyan");

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

  // 5. Repo assets — generate the head app's .env.local + xmcloud.build.json,
  //    now that the site is resolved. On by default in a head-app repo; both
  //    writers merge, so re-running is safe.
  const wantAssets = options.skipAssets ? false : (options.assets ?? isHeadAppRepo());
  let assetsWritten = false;
  if (
    wantAssets &&
    (await confirm("Generate repo assets (.env.local + xmcloud.build.json) for this head app?"))
  ) {
    logger.info("  Generating repo assets…");
    await runDeployEnvFile({
      environmentName: envName,
      site: updated.site,
      config: options.config,
    });
    const renderingHost =
      options.renderingHost ?? (updated.site ? `${updated.site}-editing-host` : undefined);
    await runDeployBuildConfig({ renderingHost, config: options.config });
    assetsWritten = true;
    logger.info("  ✓ assets: wrote .env.local + xmcloud.build.json.", "green");
  }

  // 6. Push the recipe set (optional).
  if (!options.skipPush && (await confirm("Push the recipe set to Sitecore now?"))) {
    await runRecipePush({ environmentName: envName, allowWrite: true, config: options.config });
  }

  // 7. Prune the SXA Headless OOTB default folders (opt-in, destructive).
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
      assetsWritten,
    });
  }
};
