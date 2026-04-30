#!/usr/bin/env node

/**
 * Build + spawn-based smoke checks for the published CLI surface.
 *
 * - `--help`                                  → commander help renders cleanly
 * - `telemetry status --json`                 → telemetry plumbing + JSON mode
 * - `recipe compile`                          → tsx loader + recipe schema +
 *                                                compiler + IR file write
 *
 * Failures here mean the published `dist/` is broken end-to-end. The unit
 * tests don't catch dist-only regressions (path aliases, exports field,
 * declarations).
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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

// Recipe compile end-to-end: tsx loader against a real .recipe.ts, schema
// validation, compiler emission, and IR JSON write.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-smoke-"));
const irPath = path.join(tmpDir, "cta-button.ir.json");
run([
  "recipe",
  "compile",
  "--input",
  "example/recipes/cta-button.recipe.ts",
  "--output",
  irPath,
  "--templates-root",
  "/sitecore/templates/Project/smoke/Components",
  "--renderings-root",
  "/sitecore/layout/Renderings/Project/smoke",
  "--json",
  "--quiet",
]);

if (!fs.existsSync(irPath)) {
  fail(`expected IR at ${irPath}, file missing`);
}
const ir = JSON.parse(fs.readFileSync(irPath, "utf8"));
if (ir.schemaVersion !== "1") {
  fail(`unexpected schemaVersion: ${JSON.stringify(ir.schemaVersion)}`);
}
if (!Array.isArray(ir.operations) || ir.operations.length === 0) {
  fail(`expected operations array; got ${JSON.stringify(ir.operations).slice(0, 100)}`);
}
fs.rmSync(tmpDir, { recursive: true, force: true });

process.stdout.write("smoke: ok\n");
