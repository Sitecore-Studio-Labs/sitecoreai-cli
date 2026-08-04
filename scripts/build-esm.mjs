/**
 * Build the ESM half of the dual package into `dist/esm/`.
 *
 * The CJS build (`tsc` + `tsc-alias` → `dist/`) is untouched and remains the
 * `require` half. This is purely additive: every path that resolves today
 * still resolves to exactly the same file, so no existing consumer changes
 * behaviour. ESM consumers get `dist/esm/` via the `import` condition.
 *
 * Why esbuild rather than a second `tsc` pass
 * -------------------------------------------
 * Plain `tsc` cannot emit runnable Node ESM from this source. Four separate
 * things block it, and esbuild handles all four:
 *
 *   1. ~1178 `@/*` path aliases. Node ESM has no notion of tsconfig paths,
 *      and needs fully-specified relative paths with extensions. esbuild
 *      resolves them at build time.
 *   2. 11 JSON imports (`package.json`, the config and telemetry schemas).
 *      Node ESM requires `with { type: "json" }`, which TypeScript refuses
 *      to emit under `module: CommonJS` — so the attribute cannot live in
 *      source shared by both builds. esbuild inlines the JSON instead, and
 *      the question disappears.
 *   3. `__dirname` in `recipe/sandbox/load.ts`, used to locate the forked
 *      `recipe-runner.cjs`. Undefined in ESM; `import.meta.url` is a syntax
 *      error in CJS. Neither can appear in shared source. Handled by the
 *      banner below.
 *   4. `require()` in `sync/typescript-recipe.ts` (the tsx CJS API, and the
 *      dynamic load of a user's recipe file). Also undefined in ESM, also
 *      handled by the banner.
 *
 * `splitting: true` matters
 * -------------------------
 * Without it each of the 15 entry points would bundle its own copy of shared
 * modules, and module identity would break: two entries importing the same
 * singleton (a config cache, a credential store) would each get a private
 * instance. Splitting emits shared chunks so one module stays one module.
 *
 * `packages: "external"` keeps node_modules out of the bundle — dependencies
 * resolve normally at runtime, so this is not a vendoring exercise.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import * as esbuild from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

/**
 * Entry points are derived from the published `exports` map rather than
 * hand-listed, so a new subpath cannot be added to the package without
 * automatically getting an ESM build. `./dist/x/y.js` maps back to
 * `src/x/y.ts`.
 */
const entryPoints = Object.entries(pkg.exports)
  .filter(([subpath]) => subpath !== "./package.json")
  .map(([, target]) => (typeof target === "string" ? target : (target.require ?? target.default)))
  .filter(Boolean)
  .map((distPath) => distPath.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"));

if (entryPoints.length === 0) {
  throw new Error("No ESM entry points derived from package.json exports — refusing to build.");
}

const OUTDIR = "dist/esm";

/**
 * Shims for the CJS globals that survive in the source because the CJS build
 * still needs them. Injected only into the ESM output, where they are absent.
 *
 * `createRequire(import.meta.url)` gives a `require` anchored at the emitted
 * file, which is what `sync/typescript-recipe.ts` needs to load a user's
 * recipe from an absolute path.
 */
const BANNER = `
import { createRequire as __scaiCreateRequire } from "node:module";
import { fileURLToPath as __scaiFileURLToPath } from "node:url";
import { dirname as __scaiDirname } from "node:path";
const require = __scaiCreateRequire(import.meta.url);
const __filename = __scaiFileURLToPath(import.meta.url);
const __dirname = __scaiDirname(__filename);
`.trim();

const result = await esbuild.build({
  entryPoints,
  outdir: OUTDIR,
  outbase: "src",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  // Dependencies stay external and resolve at runtime — this bundles our
  // own source together, it does not vendor node_modules.
  packages: "external",
  sourcemap: false,
  banner: { js: BANNER },
  logLevel: "warning",
  metafile: true,
});

// `"type": "module"` here overrides the root package's "commonjs" for this
// directory only, so Node reads dist/esm/*.js as ESM. Without it these files
// would be parsed as CJS and every `import` would throw.
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(resolve(OUTDIR, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");

// The forked sandbox child is CommonJS by design and is located relative to
// the emitting module's directory. The ESM build needs its own copy at the
// path `recipe/sandbox/load.js` will compute from `__dirname`.
const sandboxOut = resolve(OUTDIR, "recipe/sandbox");
mkdirSync(sandboxOut, { recursive: true });
copyFileSync("src/recipe/sandbox/recipe-runner.cjs", resolve(sandboxOut, "recipe-runner.cjs"));

// Strip the banner from every emitted file that does not actually use a shim.
//
// esbuild applies `banner` to ALL outputs — there is no per-file option — so
// without this, all 41 emitted files import `node:module` when only 2 need it.
// That is not merely dead weight: a browser bundler resolving the `import`
// condition (Next.js/Turbopack does, for the schema-only entries the showcase
// pulls into a client component) hits `node:module` in a browser chunking
// context and fails the production build with "the chunking context does not
// support external modules". The CJS build had no such marker, so the dual
// build regressed browser consumers of the pure-Zod entries.
//
// Safe to strip per-file: the three shims are file-local `const`s, so a file
// that never references them is unaffected by their removal. Files that DO
// reference them keep the banner verbatim.
const SHIM_RE = /\brequire\s*\(|__dirname|__filename/;
let stripped = 0;
for (const outPath of Object.keys(result.metafile.outputs)) {
  const source = readFileSync(outPath, "utf8");
  if (!source.startsWith(BANNER)) continue;
  const body = source.slice(BANNER.length);
  if (SHIM_RE.test(body)) continue;
  writeFileSync(outPath, body.replace(/^\n/, ""));
  stripped += 1;
}

const outputs = Object.keys(result.metafile.outputs).length;
console.log(
  `[build-esm] ${entryPoints.length} entry point(s) → ${outputs} file(s) in ${OUTDIR}/ ` +
    `(node: shim banner kept in ${outputs - stripped}, stripped from ${stripped})`
);
