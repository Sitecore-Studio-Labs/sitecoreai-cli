#!/usr/bin/env node

/**
 * Post-build smoke for the SDK subpath exports.
 *
 * Walks every `exports` subpath in package.json and resolves it through
 * the package's own `exports` map (self-reference) against the built
 * `dist/`. For each entry it asserts:
 *
 *   1. The subpath key resolves to a real file via `import()` — catches a
 *      stale `exports` target or a missing `dist/<domain>/index.js`.
 *   2. The module imports without throwing.
 *   3. The module exposes at least one symbol — catches a barrel that
 *      builds to an empty module.
 *
 * The unit tests import from `src/`, so they miss dist-only regressions
 * (wrong `exports` target, un-built declaration, path-alias rewrite).
 * Wired into `pnpm smoke` after the build.
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("../package.json");
/* eslint-enable @typescript-eslint/no-require-imports */

const fail = (message) => {
  process.stderr.write(`smoke-exports: ${message}\n`);
  process.exit(1);
};

const subpaths = Object.keys(pkg.exports).filter((k) => k !== "./package.json");

(async () => {
  for (const sub of subpaths) {
    const specifier = `${pkg.name}${sub.slice(1)}`;

    let mod;
    try {
      mod = await import(specifier);
    } catch (err) {
      fail(`import("${specifier}") failed: ${err && err.message}`);
    }

    const named = Object.keys(mod).filter((k) => k !== "default");
    const viaDefault =
      mod.default && typeof mod.default === "object" ? Object.keys(mod.default) : [];
    if (named.length === 0 && viaDefault.length === 0) {
      fail(`${specifier} resolved but exported no symbols`);
    }
  }
  process.stdout.write(`smoke-exports: ok (${subpaths.length} subpaths)\n`);
})();
