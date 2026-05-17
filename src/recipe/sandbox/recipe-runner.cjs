/**
 * Recipe sandbox child — runs the COMPILED recipe bundle.
 *
 * The trusted parent (`./load.ts`) has already transpiled `.recipe.ts` to a
 * self-contained CommonJS bundle; this child just `require()`s that bundle
 * and sends the exported recipe object back over the fork IPC channel.
 *
 * Because the recipe arrives pre-compiled, this child needs no TypeScript
 * toolchain — so the parent runs it under Node's permission model with no
 * worker threads, no child_process, and no filesystem writes. See
 * docs/recipe-sandbox.md.
 *
 * Plain `.cjs`, dependency-free: it runs in the untrusted child and must
 * not pull in scai internals. Shipped as-is and copied into `dist/` by the
 * build (tsc does not compile it).
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS child script; require() is the contract. */

const report = (result, exitCode) => {
  if (process.send) {
    process.send(result, () => process.exit(exitCode));
  } else {
    process.exit(exitCode);
  }
};

try {
  const bundlePath = process.argv[2];
  if (!bundlePath) {
    report({ ok: false, error: "no compiled-recipe path argument" }, 2);
  } else {
    const mod = require(bundlePath);
    let recipe = mod && mod.default !== undefined ? mod.default : undefined;
    if (recipe === undefined && mod && typeof mod === "object") {
      for (const key of Object.keys(mod)) {
        if (key !== "default" && mod[key] !== undefined) {
          recipe = mod[key];
          break;
        }
      }
    }
    report({ ok: true, recipe: recipe === undefined ? null : recipe }, 0);
  }
} catch (error) {
  report({ ok: false, error: error && error.message ? error.message : String(error) }, 1);
}
