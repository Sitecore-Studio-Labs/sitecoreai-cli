#!/usr/bin/env node

/**
 * Require-graph smoke: `require()` every module in `dist/` from a
 * CommonJS context — exactly what consumers (the showcase orchestrator's
 * Vercel functions, plain `node`) do at runtime.
 *
 * Exists because of the mime v4 incident: a dependabot bump swapped a
 * CJS dependency for an ESM-only major, unit tests (vitest over TS
 * source) and the spawn smokes (which never load the recipe planner)
 * both stayed green, and the break only surfaced in production as
 * `ERR_REQUIRE_ESM` inside `dist/recipe/runtime/plan.js`. Walking the
 * whole dist catches that class of failure for ANY module and ANY
 * dependency, present or future.
 *
 * Two passes with two contracts (the `smoke` script runs both):
 *
 *   1. `--sdk-strict` under `node --no-experimental-require-module` —
 *      walks the SDK-consumable graph (everything EXCEPT the CLI tree:
 *      `cli.js`, `program.js`, `commands/`). Node ≥ 22.12 supports
 *      `require()` of ESM natively, so a bare run on CI's Node passes
 *      even when strict-CJS consumers break — that is exactly how the
 *      SECOND mime v4 bump (dependabot #266) sailed through this guard
 *      and shipped in 0.32.0: the orchestrator's Vercel functions run a
 *      module loader without require(esm) support and died with
 *      ERR_REQUIRE_ESM. The flag makes this pass reproduce the
 *      strictest consumer. The CLI tree is exempt because it only ever
 *      runs inside scai's own process (`bin` under engines ≥ 22.12,
 *      where require(esm) works) — which is why an ESM-only
 *      `commander` is fine while an ESM-only dep anywhere in the SDK
 *      graph is a release blocker.
 *
 *   2. A bare full-dist walk under default Node semantics — keeps the
 *      original whole-graph guarantee for the CLI tree itself.
 *
 * `dist/cli.js` is always skipped — it is the executable entrypoint and
 * runs the program on load (the spawn smokes cover it).
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
/* eslint-enable @typescript-eslint/no-require-imports */

const DIST = path.resolve(__dirname, "..", "dist");
const SKIP = new Set([path.join(DIST, "cli.js")]);

// --sdk-strict: restrict the walk to the SDK-consumable graph (see
// docblock). Refuses to run without the strict flag — a pass that
// silently ran with require(esm) enabled would be the exact false
// green that shipped the 0.32.0 break.
const sdkStrict = process.argv.includes("--sdk-strict");
if (sdkStrict && process.features.require_module !== false) {
  process.stderr.write(
    "smoke-require: --sdk-strict must run under node --no-experimental-require-module\n"
  );
  process.exit(1);
}
const CLI_TREE = [path.join(DIST, "program.js"), path.join(DIST, "commands") + path.sep];
const inCliTree = (file) => CLI_TREE.some((prefix) => file === prefix || file.startsWith(prefix));

// `dist/esm/` is the ESM half of the dual build. Every file in it is ESM by
// design and `require()` of it throws ERR_REQUIRE_ESM correctly — so walking
// it here would report the build working as ~40 failures. This guard covers
// the CJS half only; `scripts/smoke-import.mjs` is its ESM counterpart and
// must stay in the smoke chain for the other half to be checked at all.
const ESM_DIR = path.join(DIST, "esm");

const collect = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === ESM_DIR) continue;
      collect(full, out);
    } else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
};

const files = collect(DIST).filter((file) => !SKIP.has(file) && !(sdkStrict && inCliTree(file)));
if (files.length === 0) {
  process.stderr.write("smoke-require: no dist modules found — run build first\n");
  process.exit(1);
}

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

if (failures.length > 0) {
  process.stderr.write(
    `smoke-require: ${failures.length} of ${files.length} dist modules failed to require:\n` +
      failures.map((line) => `  - ${line}`).join("\n") +
      "\n"
  );
  process.exit(1);
}

process.stdout.write(
  `smoke-require: ok (${files.length} modules${sdkStrict ? ", sdk-strict" : ""})\n`
);
