/**
 * `scai policy …` — inspect and manage the workspace environment-policy
 * guardrails. See docs/policy-and-guardrails.md.
 *
 * The workspace policy is an operator-owned, deny-by-default allowlist of
 * the Sitecore environments scai may operate against. It is normally
 * auto-populated (`scai setup login`, `scai mcp serve`); these commands
 * are for inspecting it and for the deliberate acts — enrolling a second
 * environment, re-pinning after a legitimate tenant change, revoking one.
 *
 * These commands deliberately read the config directly rather than going
 * through `resolveEnvironment`: they run before/around enrollment and
 * must not trip the very gate they manage.
 */

import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import type { CommonOptions } from "@/shared/cli-options";
import { toLogger } from "@/shared/cli-tasks";
import { readRootConfiguration, readRootConfigurationFile } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import type { EnvironmentConfiguration } from "@/config/types";
import {
  enrollEnvironment,
  readRepoPolicy,
  readWorkspacePolicy,
  repinEnvironment,
  resolveUserPolicyPath,
  setEnvironmentFlags,
  unenrollEnvironment,
} from "@/policy";
import type { EnvironmentFlags, RiskTier } from "@/policy";

interface PolicyOptions extends CommonOptions {
  environmentName?: string;
}

const POLICY_WRITE_FAILED_HINT =
  "Check that ~/.sitecoreai is writable, or set SITECOREAI_POLICY_HOME.";

/**
 * Resolve an env profile's raw config without going through
 * `resolveEnvironment` (which would enforce the policy).
 */
const resolveEnvProfile = (
  options: PolicyOptions,
  envNameArg?: string
): { envName: string; environment: EnvironmentConfiguration } => {
  const configPath = options.config ?? process.cwd();
  const file = readRootConfigurationFile(configPath);
  const envName = envNameArg ?? options.environmentName ?? file.config.defaultEnvProfile;
  if (!envName) {
    throw createScaiError("An environment name is required.", "INPUT_INVALID", {
      hint: "Pass the environment name, or set defaultEnvProfile in sitecoreai.cli.json.",
    });
  }
  const environment = readRootConfiguration(configPath, envName).environments[envName];
  if (!environment) {
    throw createScaiError(`Environment '${envName}' is not configured.`, "ENV_NOT_FOUND", {
      hint: "Run 'scai setup init' to configure it before enrolling it in the policy.",
    });
  }
  return { envName, environment };
};

const runPolicyShow = async (options: PolicyOptions): Promise<void> => {
  const logger = toLogger(options);
  const policy = readWorkspacePolicy();
  const policyPath = resolveUserPolicyPath();

  let repoPolicy: ReturnType<typeof readRepoPolicy> = null;
  try {
    const rootDir = readRootConfigurationFile(options.config ?? process.cwd()).rootDir;
    repoPolicy = readRepoPolicy(rootDir);
  } catch {
    // No config file resolvable from here — the repo policy is simply absent.
  }

  if (logger.isJson()) {
    logger.json({
      managed: policy !== null,
      policyPath,
      environments: policy
        ? Object.entries(policy.environments).map(([name, entry]) => ({ name, ...entry }))
        : [],
      repoPolicy,
    });
    return;
  }

  if (!policy) {
    logger.info("Workspace policy: unmanaged — no policy file.", "yellow");
    logger.info(
      "Environment guardrails are off. Run 'scai policy init' (or 'scai setup login') to enable them."
    );
    return;
  }

  logger.info(`Workspace policy: ${policyPath}`, "cyan");
  const names = Object.keys(policy.environments).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    logger.warn("No environments are enrolled — every environment is currently denied.");
  }
  for (const name of names) {
    const entry = policy.environments[name];
    const id = entry.identity;
    const idParts = [
      id.organizationId && `org=${id.organizationId}`,
      id.projectId && `project=${id.projectId}`,
      id.environmentId && `environment=${id.environmentId}`,
      id.host && `host=${id.host}`,
    ].filter(Boolean);
    logger.info(`\n  ${name}`, "green");
    logger.info(`    ceiling:  ${entry.ceiling}`);
    logger.info(`    mint:     ${entry.mintCredentials ? "allowed" : "denied"}`);
    logger.info(`    ciWrites: ${entry.ciWrites ? "allowed" : "denied"}`);
    logger.info(`    step-up:  ${entry.stepUpMinutes ? `${entry.stepUpMinutes} min` : "off"}`);
    logger.info(`    enrolled: ${entry.enrolledAt} (via ${entry.enrolledVia})`);
    logger.info(`    identity: ${idParts.length > 0 ? idParts.join(", ") : "(none pinned)"}`);
  }
  if (repoPolicy) {
    logger.info("\n  repo policy (scai.policy.json) is narrowing this workspace:", "magenta");
    if (repoPolicy.allowEnvironments) {
      logger.info(`    allowEnvironments: ${repoPolicy.allowEnvironments.join(", ")}`);
    }
    for (const [name, entry] of Object.entries(repoPolicy.environments ?? {})) {
      if (entry.ceiling) {
        logger.info(`    ${name}: ceiling lowered to ${entry.ceiling}`);
      }
    }
  }
};

const runPolicyInit = async (options: PolicyOptions): Promise<void> => {
  const logger = toLogger(options);
  const wasManaged = readWorkspacePolicy() !== null;
  const { envName, environment } = resolveEnvProfile(options);
  const result = enrollEnvironment({ envName, environment, via: "policy-init" });
  if (!result.written) {
    throw createScaiError("Could not write the workspace policy.", "CONFIG_INVALID", {
      hint: POLICY_WRITE_FAILED_HINT,
    });
  }
  if (logger.isJson()) {
    logger.json({ envName, created: !wasManaged, policyPath: resolveUserPolicyPath() });
    return;
  }
  if (!wasManaged) {
    logger.info(`Workspace policy created at ${resolveUserPolicyPath()}.`, "cyan");
  }
  logger.info(`Environment '${envName}' enrolled — guardrails are active.`, "green");
};

const runPolicyAllow = async (
  envNameArg: string | undefined,
  options: PolicyOptions
): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment } = resolveEnvProfile(options, envNameArg);
  const result = enrollEnvironment({ envName, environment, via: "policy-allow" });
  if (!result.written) {
    throw createScaiError("Could not write the workspace policy.", "CONFIG_INVALID", {
      hint: POLICY_WRITE_FAILED_HINT,
    });
  }
  const action = result.alreadyEnrolled ? "refreshed" : "enrolled";
  if (logger.isJson()) {
    logger.json({ envName, action });
    return;
  }
  logger.info(`Environment '${envName}' ${action} in the workspace policy.`, "green");
};

const runPolicyRemove = async (
  envNameArg: string | undefined,
  options: PolicyOptions
): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const envName =
    envNameArg ??
    options.environmentName ??
    readRootConfigurationFile(configPath).config.defaultEnvProfile;
  if (!envName) {
    throw createScaiError("An environment name is required.", "INPUT_INVALID", {
      hint: "Pass the environment name to remove from the allowlist.",
    });
  }
  const removed = unenrollEnvironment(envName);
  if (logger.isJson()) {
    logger.json({ envName, action: removed ? "removed" : "not-enrolled" });
    return;
  }
  if (removed) {
    logger.info(`Environment '${envName}' removed from the workspace policy.`, "green");
  } else {
    logger.warn(`Environment '${envName}' was not enrolled — nothing to remove.`);
  }
};

const runPolicyTrust = async (
  envNameArg: string | undefined,
  options: PolicyOptions
): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment } = resolveEnvProfile(options, envNameArg);
  const policy = readWorkspacePolicy();
  if (!policy || !policy.environments[envName]) {
    throw createScaiError(
      `Environment '${envName}' is not enrolled in the workspace policy.`,
      "POLICY_DENIED",
      { hint: `Run 'scai policy allow ${envName}' to enroll it first.` }
    );
  }
  repinEnvironment(envName, environment);
  if (logger.isJson()) {
    logger.json({ envName, action: "re-pinned" });
    return;
  }
  logger.info(
    `Environment '${envName}' identity re-pinned to the current sitecoreai.cli.json.`,
    "green"
  );
};

interface PolicySetOptions extends PolicyOptions {
  ceiling?: string;
  ciWrites?: string;
  mint?: string;
  stepUp?: string;
}

const runPolicySet = async (
  envNameArg: string | undefined,
  options: PolicySetOptions
): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const envName =
    envNameArg ??
    options.environmentName ??
    readRootConfigurationFile(configPath).config.defaultEnvProfile;
  if (!envName) {
    throw createScaiError("An environment name is required.", "INPUT_INVALID", {
      hint: "Pass the environment name to tune.",
    });
  }

  const flags: EnvironmentFlags = {};
  if (options.ceiling) {
    flags.ceiling = options.ceiling as RiskTier;
  }
  if (options.ciWrites) {
    flags.ciWrites = options.ciWrites === "on";
  }
  if (options.mint) {
    flags.mintCredentials = options.mint === "on";
  }
  if (options.stepUp) {
    if (options.stepUp.toLowerCase() === "off") {
      flags.stepUpMinutes = null;
    } else {
      const minutes = Number(options.stepUp);
      if (!Number.isInteger(minutes) || minutes <= 0) {
        throw createScaiError(
          "--step-up must be a positive whole number of minutes, or 'off'.",
          "INPUT_INVALID",
          { hint: "Example: scai policy set prod --step-up 60" }
        );
      }
      flags.stepUpMinutes = minutes;
    }
  }
  if (Object.keys(flags).length === 0) {
    throw createScaiError("Nothing to change.", "INPUT_INVALID", {
      hint: "Pass at least one of --ceiling, --ci-writes, or --mint.",
    });
  }

  const updated = setEnvironmentFlags(envName, flags);
  if (!updated) {
    throw createScaiError(
      `Environment '${envName}' is not enrolled in the workspace policy.`,
      "POLICY_DENIED",
      { hint: `Run 'scai policy allow ${envName}' to enroll it first.` }
    );
  }
  if (logger.isJson()) {
    logger.json({ envName, ...flags });
    return;
  }
  logger.info(`Updated the workspace policy for '${envName}'.`, "green");
};

export const createPolicyCommand = (): Command => {
  const command = new Command("policy").description(
    "Inspect and manage the workspace environment-policy guardrails — the allowlist of Sitecore environments scai may operate against."
  );

  const show = new Command("show").description(
    "Show the effective workspace policy and the enrolled environments."
  );
  addConfigOption(show);
  addVerbosityOptions(show);
  show.action(async (options: PolicyOptions) => runPolicyShow(options));

  const init = new Command("init").description(
    "Create the workspace policy, enrolling the default environment."
  );
  addConfigOption(init);
  addEnvironmentOption(init);
  addVerbosityOptions(init);
  init.action(async (options: PolicyOptions) => runPolicyInit(options));

  const allow = new Command("allow")
    .description("Enroll an environment into the workspace-policy allowlist.")
    .argument("[env]", "Environment profile name (defaults to the configured default).");
  addConfigOption(allow);
  addVerbosityOptions(allow);
  allow.action(async (env: string | undefined, options: PolicyOptions) =>
    runPolicyAllow(env, options)
  );

  const remove = new Command("remove")
    .aliases(["rm"])
    .description("Remove an environment from the workspace-policy allowlist.")
    .argument("[env]", "Environment profile name (defaults to the configured default).");
  addConfigOption(remove);
  addVerbosityOptions(remove);
  remove.action(async (env: string | undefined, options: PolicyOptions) =>
    runPolicyRemove(env, options)
  );

  const trust = new Command("trust")
    .description(
      "Re-pin an enrolled environment's tenant identity to the current config, after a legitimate change."
    )
    .argument("[env]", "Environment profile name (defaults to the configured default).");
  addConfigOption(trust);
  addVerbosityOptions(trust);
  trust.action(async (env: string | undefined, options: PolicyOptions) =>
    runPolicyTrust(env, options)
  );

  const set = new Command("set")
    .description("Tune an enrolled environment — ceiling, CI-write permission, mint eligibility.")
    .argument("[env]", "Environment profile name (defaults to the configured default).")
    .addOption(
      new Option("--ceiling <tier>", "Cap the environment at this risk tier.").choices([
        "read",
        "write",
        "destructive",
        "mint",
      ])
    )
    .addOption(
      new Option(
        "--ci-writes <state>",
        "Allow or deny write/destructive operations from a CI caller."
      ).choices(["on", "off"])
    )
    .addOption(
      new Option(
        "--mint <state>",
        "Allow or deny `scai setup client create` minting on this environment."
      ).choices(["on", "off"])
    )
    .addOption(
      new Option(
        "--step-up <minutes>",
        "Require a deploy token authenticated within N minutes for destructive/mint ops; 'off' to clear."
      )
    );
  addConfigOption(set);
  addVerbosityOptions(set);
  set.action(async (env: string | undefined, options: PolicySetOptions) =>
    runPolicySet(env, options)
  );

  command.addCommand(show);
  command.addCommand(init);
  command.addCommand(allow);
  command.addCommand(set);
  command.addCommand(remove);
  command.addCommand(trust);

  command.addHelpText(
    "after",
    [
      "",
      "The workspace policy is a deny-by-default allowlist of the environments",
      "scai may operate against, kept at ~/.sitecoreai/policy.json. It is",
      "normally auto-populated by 'scai setup login' and 'scai mcp serve' — a",
      "second environment is the one thing that needs a deliberate 'allow'.",
      "",
      "Examples:",
      "  $ scai policy show                  # what is allowed right now",
      "  $ scai policy allow staging         # enroll a second environment",
      "  $ scai policy set staging --ci-writes on   # let a CI caller write here",
      "  $ scai policy trust staging         # re-pin after a legitimate tenant change",
      "  $ scai policy remove staging        # revoke an environment",
      "",
    ].join("\n")
  );

  return command;
};
