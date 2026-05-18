#!/usr/bin/env node
"use strict";

/**
 * scai MCP Bundle launcher — "smart launcher".
 *
 * Claude Desktop spawns this file as a stdio MCP server. It re-execs the
 * locally-installed scai CLI as `scai mcp serve`, passing stdin/stdout/
 * stderr straight through so JSON-RPC frames flow untouched.
 *
 * Startup must be fast — an MCP server has to answer the `initialize`
 * handshake promptly, so the launcher never does slow/authenticated work
 * before spawning `mcp serve`. It resolves a config synchronously:
 *
 *   - `config_path` set to the user's own config -> serve it (read-only).
 *   - A bundle-managed config from a previous launch -> serve it.
 *   - Org credential supplied, no config yet -> write a starter config
 *     instantly (no network) and serve it, THEN run `scai setup init` in
 *     the background to discover the CM host / project / environment and
 *     complete the config for the next launch.
 *   - None of the above -> print copy-paste setup instructions and exit.
 *
 * Diagnostics: every launch appends to `~/.sitecoreai/mcpb/launcher.log`
 * (which also receives the background `scai setup init` output) and is
 * mirrored to stderr with synchronous writes, so a message is never lost
 * to an early `process.exit`.
 *
 * stdout discipline: this launcher must never write to stdout — that
 * channel is exclusively JSON-RPC frames from the child.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS bundle launcher; require() is the contract. */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Bump on every rebuild — Claude Desktop treats a bundle with an unchanged
// version as already-installed and will not pick up new launcher code.
const BUNDLE_VERSION = "0.1.0";

const bundleConfigDir = path.join(os.homedir(), ".sitecoreai", "mcpb");
const bundleConfigPath = path.join(bundleConfigDir, "sitecoreai.cli.json");
const logFile = path.join(bundleConfigDir, "launcher.log");

/**
 * Append to the launcher log and mirror to stderr. `fs.writeSync` is
 * synchronous, so the message survives an immediate `process.exit` — the
 * async `process.stderr.write` does not.
 */
const log = (message) => {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.mkdirSync(bundleConfigDir, { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    /* logging is best-effort */
  }
  try {
    fs.writeSync(2, line);
  } catch {
    /* stderr is best-effort */
  }
};

const fail = (message) => {
  log(`ERROR: ${message}`);
  log(`see ${logFile} for the full launch log`);
  process.exit(1);
};

/** Trim, and drop any value Claude Desktop left as an unsubstituted token. */
const clean = (value) => {
  const trimmed = (value || "").trim();
  return trimmed.includes("${") ? "" : trimmed;
};

log(`=== scai-mcpb launcher v${BUNDLE_VERSION} start ===`);

const cliPath = clean(process.env.SCAI_CLI_PATH);
if (!cliPath) {
  fail(
    "no scai CLI path configured. Open the scai extension settings and set " +
      "'scai CLI entry point' to the dist/cli.js of a built scai checkout."
  );
}
if (!fs.existsSync(cliPath)) {
  fail(`scai CLI not found at '${cliPath}'. Check the extension settings.`);
}

const explicitEnvName = clean(process.env.SCAI_ENVIRONMENT_NAME);
const envName = explicitEnvName || "default";
const userConfigPath = clean(process.env.SCAI_CONFIG_PATH);
const orgId = clean(process.env.SCAI_ORG_ID);
const clientId = clean(process.env.SCAI_CLIENT_ID);
const clientSecret = clean(process.env.SCAI_CLIENT_SECRET);
const deployProject = clean(process.env.SCAI_DEPLOY_PROJECT);
const deployEnvironment = clean(process.env.SCAI_DEPLOY_ENVIRONMENT);

log(
  `cli=${cliPath} env=${envName} userConfig=${userConfigPath || "(none)"} ` +
    `orgId=${orgId ? "set" : "(none)"} clientId=${clientId ? "set" : "(none)"} ` +
    `clientSecret=${clientSecret ? "set" : "(none)"}`
);

// All three parts of a bring-your-own-client credential are needed to write
// a starter config and run `scai setup init`.
const hasBootstrapCredential = Boolean(orgId && clientId && clientSecret);

// Child environment shared by `setup init` and `mcp serve`: the launcher's
// own SCAI_* inputs are stripped so they don't leak into scai.
const childEnv = { ...process.env };
for (const key of [
  "SCAI_CLI_PATH",
  "SCAI_ENVIRONMENT_NAME",
  "SCAI_CONFIG_PATH",
  "SCAI_ORG_ID",
  "SCAI_CLIENT_ID",
  "SCAI_CLIENT_SECRET",
  "SCAI_DEPLOY_PROJECT",
  "SCAI_DEPLOY_ENVIRONMENT",
]) {
  delete childEnv[key];
}

const printColdStartHelp = () => {
  log(
    [
      "no Sitecore environment is configured.",
      "Pick one of these, then re-enable the extension:",
      "  A. Fill the credential fields in the extension settings —",
      "     Sitecore organization ID and an automation client ID + secret.",
      "  B. Configure scai once in a terminal, then point the extension's",
      "     'Config file' field at the sitecoreai.cli.json it writes:",
      `       node "${cliPath}" setup init --wizard`,
      `       node "${cliPath}" setup login`,
    ].join("\n")
  );
};

/** Write a starter config — no network, instant — so `mcp serve` can bind. */
const writeStarterConfig = () => {
  fs.mkdirSync(bundleConfigDir, { recursive: true });
  const config = {
    $schema: "https://schemas.sitecoreai.dev/v1/sitecoreai.cli.json",
    defaultEnvProfile: envName,
    envProfiles: {
      [envName]: {
        organizationId: orgId,
        authority: "https://auth.sitecorecloud.io",
        audience: "https://api.sitecorecloud.io",
        clientId,
        useClientCredentials: true,
      },
    },
  };
  fs.writeFileSync(bundleConfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  log(`wrote starter bundle config at ${bundleConfigPath} (CM host pending discovery)`);
};

/** True when the bundle config's bound profile already has a CM host. */
const bundleConfigIsComplete = () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(bundleConfigPath, "utf8"));
    return Boolean(cfg.envProfiles && cfg.envProfiles[envName] && cfg.envProfiles[envName].host);
  } catch {
    return false;
  }
};

/**
 * Detached, non-blocking `scai setup init`: scai mints a token from the
 * client credential and uses the Deploy API to discover the CM host,
 * project, environment, and tenant, completing the bundle config for the
 * NEXT launch. Output goes to the launcher log. Never blocks startup.
 */
const startBackgroundInit = () => {
  const args = [
    cliPath,
    "setup",
    "init",
    "--environment-name",
    envName,
    "--config",
    bundleConfigPath,
    "--non-interactive",
    "--set-default",
    "--use-client-credentials",
    "--client-id",
    clientId,
    "--organization-id",
    orgId,
    "--deploy-organization",
    orgId,
  ];
  if (deployProject) args.push("--project", deployProject);
  if (deployEnvironment) args.push("--deploy-environment", deployEnvironment);

  let logFd;
  try {
    logFd = fs.openSync(logFile, "a");
  } catch {
    logFd = undefined;
  }
  log("background: completing the config via 'scai setup init' (output in this log)");
  try {
    const init = spawn(process.execPath, args, {
      env: { ...childEnv, SITECOREAI_CLIENT_SECRET: clientSecret, SITECOREAI_NON_INTERACTIVE: "1" },
      stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"],
      detached: true,
    });
    init.unref();
  } catch (error) {
    log(`background init could not be started: ${error.message}`);
  }
  if (logFd !== undefined) {
    try {
      fs.closeSync(logFd);
    } catch {
      /* the detached child kept its own handle */
    }
  }
};

/** Resolve the config path to serve. Fast — no network. */
const resolveConfigPath = () => {
  // The user pointed at their own config — use it read-only, never write.
  if (userConfigPath) {
    if (fs.existsSync(userConfigPath)) return userConfigPath;
    fail(
      `config file not found at '${userConfigPath}'. Fix the 'Config file' ` +
        "setting, or clear it to use the bundle-managed config."
    );
  }

  // Bundle-managed config. Reuse one from a previous launch; otherwise write
  // a starter config now so the server can come up immediately.
  if (!fs.existsSync(bundleConfigPath)) {
    if (!hasBootstrapCredential) {
      printColdStartHelp();
      process.exit(1);
    }
    writeStarterConfig();
  } else {
    log(`reusing bundle config ${bundleConfigPath}`);
  }

  // If the bundle config still lacks a CM host, kick off discovery in the
  // background so the next launch is fully provisioned. The server still
  // comes up now; CM/Authoring tools work once the host is filled in.
  if (hasBootstrapCredential && !bundleConfigIsComplete()) {
    startBackgroundInit();
  }
  return bundleConfigPath;
};

const configPath = resolveConfigPath();

const args = [cliPath, "mcp", "serve", "--config", configPath];
// Bind the profile name explicitly for the bundle-managed config (the
// launcher owns its name). For the user's own config, bind only when they
// named one — otherwise the config's own defaultEnvProfile applies.
if (!userConfigPath || explicitEnvName) {
  args.push("--environment-name", envName);
}

// The secret travels as an env var, never on disk. An empty value would
// look "set" to scai and shadow its normal auth, so forward only when set.
const serveEnv = { ...childEnv };
if (clientSecret) serveEnv.SITECOREAI_CLIENT_SECRET = clientSecret;

log(`starting: scai ${args.slice(1).join(" ")}`);

// `process.execPath` is the Node runtime Claude Desktop spawned us with, so
// the child runs on the same Node without depending on a `node` on PATH.
const child = spawn(process.execPath, args, { stdio: "inherit", env: serveEnv });

child.on("error", (error) => fail(`failed to launch scai: ${error.message}`));
child.on("exit", (code) => {
  log(`scai mcp serve exited with code ${code}`);
  process.exit(code == null ? 0 : code);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
