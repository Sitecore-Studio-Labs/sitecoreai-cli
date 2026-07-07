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
 * `dist/cli.js` is skipped — it is the executable entrypoint and runs
 * the program on load (the spawn smokes cover it).
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
/* eslint-enable @typescript-eslint/no-require-imports */

const DIST = path.resolve(__dirname, "..", "dist");
const SKIP = new Set([path.join(DIST, "cli.js")]);

const collect = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
};

const files = collect(DIST).filter((file) => !SKIP.has(file));
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

process.stdout.write(`smoke-require: ok (${files.length} modules)\n`);
