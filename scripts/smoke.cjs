#!/usr/bin/env node

/**
 * Build + spawn-based smoke checks for the published CLI surface.
 *
 * - `--help`                                  → commander help renders cleanly
 * - `telemetry status --json`                 → telemetry plumbing + JSON mode
 *
 * Failures here mean the published `dist/` is broken end-to-end. The unit
 * tests don't catch dist-only regressions (path aliases, exports field,
 * declarations).
 *
 * Recipe compile smoke was removed when `recipe` was un-advertised for 0.0.4
 * (the subcommand is no longer reachable from the CLI). Restore when the
 * recipe surface is graduated for 0.1.0.
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
/* eslint-enable @typescript-eslint/no-require-imports */

const CLI = path.join("dist", "cli.js");

const fail = (message) => {
  process.stderr.write(`smoke: ${message}\n`);
  process.exit(1);
};

const run = (args, options = {}) => {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    stdio: options.captureStdout ? ["ignore", "pipe", "ignore"] : "ignore",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`exit ${result.status} for ${args.join(" ")}`);
  }
  return result.stdout;
};

run(["--help"]);
run(["telemetry", "status", "--json"]);

process.stdout.write("smoke: ok\n");
