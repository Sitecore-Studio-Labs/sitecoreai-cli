#!/usr/bin/env node

/**
 * Browser-condition smoke: prove the schema-only entries can be bundled for a
 * browser.
 *
 * Exists because 0.40.0 shipped a dual ESM build whose banner put
 * `import { createRequire } from "node:module"` at the top of every emitted
 * file. Next.js/Turbopack resolves the `import` condition, so the showcase's
 * client components reached `dist/esm/recipe/schema.js`, and its production
 * build died with:
 *
 *   the chunking context (unknown) does not support external modules
 *   (request: node:module)
 *
 * Nothing in this repo's CI noticed. `smoke-import.mjs` imports every entry
 * point under **Node**, where `node:module` resolves fine. The gap was never
 * "does it load" — it was "does it load somewhere without Node built-ins".
 *
 * The check: bundle each browser-safe entry with esbuild at
 * `platform: "browser"`. esbuild refuses to resolve `node:*` for a browser
 * target, so a banner (or any other Node built-in that creeps into these
 * entries) fails the build here rather than in a consumer's.
 *
 * Only the SCHEMA entries are in scope, and that is deliberate. They are pure
 * Zod — no fs, no http, no child_process — and they are what a frontend
 * actually imports (the showcase's `src/lib/registry/sitecore-recipes.ts`
 * pulls all five into a module reachable from a client component). The
 * runtime entries (`./deploy`, `./serialization`, `./sync`, …) legitimately
 * need Node and are not expected to bundle for a browser; asserting on them
 * would be wrong, not stricter.
 *
 * Side-effect imports count. `dist/esm/brand/recipe/schema-only.js` reaches a
 * shared chunk via a bare `import "../../chunk-X.js"` with no bindings, which
 * a `from`-based grep does not see but a bundler absolutely does — so this
 * walks the real graph instead of matching source text.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

/**
 * Subpaths a browser may import. Keep this list explicit rather than derived:
 * a new entry should be an intentional decision about whether it is
 * browser-safe, not something that silently joins the contract.
 */
const BROWSER_SAFE = [
  "./recipe/schema",
  "./unstable/brand/schema",
  "./unstable/brief/schema",
  "./unstable/campaigns/schema",
  "./unstable/agents/schema",
];

const failures = [];
const checked = [];

for (const subpath of BROWSER_SAFE) {
  const entry = pkg.exports?.[subpath]?.default;
  if (!entry) {
    failures.push(`${subpath}: no resolvable condition in package.json exports`);
    continue;
  }
  const absolute = resolve(ROOT, entry);
  try {
    await esbuild.build({
      entryPoints: [absolute],
      bundle: true,
      write: false,
      format: "esm",
      // The whole point: browser platform refuses to resolve `node:*`.
      platform: "browser",
      conditions: ["browser", "import"],
      // Third-party deps (zod) stay external — we are testing OUR output, not
      // vendoring the tree. Node built-ins are NOT external, so they surface.
      external: Object.keys(pkg.dependencies ?? {}),
      logLevel: "silent",
    });
    checked.push(subpath);
  } catch (error) {
    const detail = (error?.errors ?? [])
      .map((e) => e.text)
      .join("; ")
      .trim();
    failures.push(`${subpath} (${entry}): ${detail || error.message}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `smoke-browser: ${failures.length} of ${BROWSER_SAFE.length} browser-safe ` +
      `entr${failures.length === 1 ? "y" : "ies"} cannot bundle for a browser:\n` +
      failures.map((line) => `  - ${line}`).join("\n") +
      "\n\nA Node built-in reached a schema-only entry. Most likely the ESM shim " +
      "banner was applied to a file that does not need it — see " +
      "scripts/build-esm.mjs.\n"
  );
  process.exit(1);
}

process.stdout.write(`smoke-browser: ok (${checked.length} browser-safe entry points bundle)\n`);
