#!/usr/bin/env node

/**
 * Require-graph smoke: `require()` every module in `dist/` from a
 * CommonJS context — exactly what consumers (the showcase orchestrator's
 * Vercel functions, plain `node`) do at runtime.
 *
 * Exists because of the mime v4 incidents: a dependabot bump swapped a
 * CJS dependency for an ESM-only major, unit tests (vitest over TS
 * source) and the spawn smokes (which never load the recipe planner)
 * both stayed green, and the break only surfaced in production as
 * `ERR_REQUIRE_ESM` inside `dist/recipe/runtime/plan.js`. Walking the
 * whole dist catches that class of failure for ANY module and ANY
 * dependency, present or future.
 *
 * TWO surfaces, two strictness levels:
 *
 * - LIBRARY surface (everything except the Commander tree): walked with
 *   require(esm) DISABLED (`--no-experimental-require-module`).
 *   External CJS consumers include runtimes whose loaders don't
 *   implement require(esm) at all — Vercel's function wrapper threw
 *   ERR_REQUIRE_ESM on mime v4 even on a Node ≥22 runtime. Node ≥22.12
 *   CI silently tolerates ESM-only deps without the flag, which is how
 *   the SECOND mime-v4 bump (dependabot #266 → 0.32.0) sailed through
 *   and took down the orchestrator's dev environment.
 *
 * - EXECUTABLE surface (`dist/commands/**`, `dist/program.js`): walked
 *   with default semantics. It only ever runs via the `scai` binary
 *   under the package's own `engines` gate (Node ≥22.12, where
 *   require(esm) works), and its Commander dependency is ESM-only by
 *   design. It is never part of the SDK contract.
 *
 * `dist/cli.js` is skipped — it is the executable entrypoint and runs
 * the program on load (the spawn smokes cover it).
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
/* eslint-enable @typescript-eslint/no-require-imports */

const DIST = path.resolve(__dirname, "..", "dist");
const SKIP = new Set([path.join(DIST, "cli.js")]);

/** Executable-only modules: Commander tree, engines-gated at runtime. */
const isExecutableSurface = (file) =>
  file === path.join(DIST, "program.js") || file.startsWith(path.join(DIST, "commands") + path.sep);

const collect = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
};

const requireAll = (files) => {
  const failures = [];
  for (const file of files) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS require IS the behavior under test
      require(file);
    } catch (error) {
      failures.push(
        `${path.relative(DIST, file)}: ${error && error.message ? error.message.split("\n")[0] : String(error)}`
      );
    }
  }
  return failures;
};

const strictMode = process.execArgv.includes("--no-experimental-require-module");

if (process.env.SMOKE_REQUIRE_SURFACE === "library") {
  // Child pass: strict-CJS walk of the library surface only.
  const files = collect(DIST).filter((file) => !SKIP.has(file) && !isExecutableSurface(file));
  const failures = requireAll(files);
  if (failures.length > 0) {
    process.stderr.write(
      `smoke-require: ${failures.length} of ${files.length} library modules failed strict-CJS require (ESM-only dependency in the SDK surface?):\n` +
        failures.map((line) => `  - ${line}`).join("\n") +
        "\n"
    );
    process.exit(1);
  }
  process.stdout.write(
    `smoke-require: library surface ok under strict CJS (${files.length} modules)\n`
  );
  process.exit(0);
}

// Parent pass 1: strict-CJS library walk in a child process (the flag is
// process-wide, so it must be its own node invocation).
const strict = spawnSync(
  process.execPath,
  [
    ...process.execArgv.filter((a) => a !== "--no-experimental-require-module"),
    "--no-experimental-require-module",
    __filename,
  ],
  { stdio: "inherit", env: { ...process.env, SMOKE_REQUIRE_SURFACE: "library" } }
);
if (strict.status !== 0) process.exit(strict.status ?? 1);

if (strictMode) {
  // Invoked with the flag directly: the strict library pass above is the
  // meaningful check; default-semantics coverage of the executable
  // surface is impossible in this process, so stop here.
  process.exit(0);
}

// Parent pass 2: executable surface under default (engines-realistic)
// semantics — Node ≥22.12 require(esm) applies, matching the `scai`
// binary's actual runtime contract.
const executableFiles = collect(DIST).filter(
  (file) => !SKIP.has(file) && isExecutableSurface(file)
);
const failures = requireAll(executableFiles);
if (failures.length > 0) {
  process.stderr.write(
    `smoke-require: ${failures.length} of ${executableFiles.length} executable-surface modules failed to require:\n` +
      failures.map((line) => `  - ${line}`).join("\n") +
      "\n"
  );
  process.exit(1);
}

process.stdout.write(`smoke-require: executable surface ok (${executableFiles.length} modules)\n`);
