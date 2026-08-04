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
// `./dist/esm/x/y.js` and `./dist/x/y.js` both map back to `src/x/y.ts`.
// The `esm/` segment must be stripped first: since the CommonJS build was
// dropped, `exports` points at `./dist/esm/...`, and leaving that segment in
// yields a nonexistent `src/esm/...` entry point.
const toSource = (distPath) =>
  distPath.replace(/^\.\/dist\/(esm\/)?/, "src/").replace(/\.js$/, ".ts");

const allSubpaths = Object.entries(pkg.exports)
  .filter(([subpath]) => subpath !== "./package.json")
  .map(([subpath, target]) => [
    subpath,
    typeof target === "string" ? target : (target.require ?? target.default),
  ])
  .filter(([, target]) => Boolean(target));

/**
 * Subpaths a browser may import. These are pure Zod — no fs, no http — and are
 * what a frontend actually pulls in (the showcase reaches all five from a
 * module imported by a client component).
 *
 * They are built in their OWN esbuild pass, with no shim banner, so that no
 * Node built-in can reach them through a shared chunk. Keep this list explicit:
 * a new subpath should be a deliberate decision about browser-safety, not
 * something that silently joins the contract. `scripts/smoke-browser.mjs`
 * enforces the result.
 */
const BROWSER_SAFE_SUBPATHS = new Set([
  "./recipe/schema",
  "./unstable/brand/schema",
  "./unstable/brief/schema",
  "./unstable/campaigns/schema",
  "./unstable/agents/schema",
]);

const browserEntryPoints = allSubpaths
  .filter(([subpath]) => BROWSER_SAFE_SUBPATHS.has(subpath))
  .map(([, target]) => toSource(target));
let nodeEntryPoints = allSubpaths
  .filter(([subpath]) => !BROWSER_SAFE_SUBPATHS.has(subpath))
  .map(([, target]) => toSource(target));

// The CLI binary is not in `exports` — it is reached through `bin`, so it has
// to be named explicitly or the build silently emits no `cli.js` and the
// installed `scai` command dies with ERR_MODULE_NOT_FOUND. `program.ts` and
// `commands/**` come along through its import graph.
const BIN_ENTRY = "src/cli.ts";
if (!nodeEntryPoints.includes(BIN_ENTRY)) {
  nodeEntryPoints.push(BIN_ENTRY);
}

if (browserEntryPoints.length !== BROWSER_SAFE_SUBPATHS.size) {
  throw new Error(
    `BROWSER_SAFE_SUBPATHS names ${BROWSER_SAFE_SUBPATHS.size} subpath(s) but only ` +
      `${browserEntryPoints.length} resolved from package.json exports — a rename left this stale.`
  );
}
if (nodeEntryPoints.length === 0) {
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

const shared = {
  outdir: OUTDIR,
  outbase: "src",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "node22",
  // Dependencies stay external and resolve at runtime — this bundles our
  // own source together, it does not vendor node_modules.
  packages: "external",
  sourcemap: false,
  logLevel: "warning",
  metafile: true,
};

// Pass 1 — Node entries. These legitimately use `require`/`__dirname`, and
// esbuild's own CJS-interop helper (`__require`) reads `require` as a value,
// so the banner is load-bearing here.
const result = await esbuild.build({
  ...shared,
  entryPoints: nodeEntryPoints,
  platform: "node",
  banner: { js: BANNER },
});

// Pass 2 — browser-safe schema entries. NO banner, and a separate pass so they
// cannot share a chunk with Node-dependent code.
//
// A single pass cannot express this. With `splitting: true` esbuild hoists its
// helpers into a chunk shared by every entry, and the schema entries reach it
// through a bare side-effect import (`import "../../chunk-X.js"`, no bindings —
// invisible to a source grep, entirely visible to a bundler). So one banner on
// that shared chunk poisons all five schema entries no matter how carefully the
// per-file stripping is tuned. That is the shape of the 0.40.0 bug, and
// per-file stripping only ever treated the symptom.
//
// Cost: the two passes duplicate any module reachable from both. Measured, that
// is two pure helper functions (`defaultSitecoreFieldType`,
// `sitecoreFieldTypeLabel`) whose identity nothing depends on — no class, no
// error type, nothing behind an `instanceof`. `smoke-import.mjs` allows exactly
// those two and still enforces single-identity for everything else.
const browserResult = await esbuild.build({
  ...shared,
  entryPoints: browserEntryPoints,
  platform: "neutral",
  conditions: ["browser", "import"],
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

// No per-file banner stripping. There used to be some, and it was a mistake
// twice over.
//
// The banner exists for the Node pass and is harmless there. It was only ever
// a problem for browser consumers, and that is now solved structurally by
// building the schema entries in their own bannerless pass above. Trying to
// decide per-file whether a shim is "actually used" meant pattern-matching
// generated code, and generated code does not cooperate:
//
//   0.40.1 tested `\brequire\s*\(` — the call form — and stripped the banner
//   off a chunk holding esbuild's interop helper, which reads `require` as a
//   VALUE and never calls it. `typeof require` on an undeclared identifier is
//   legal and yields "undefined", so nothing threw at import time; it fell
//   through to a throwing Proxy and surfaced as 13 failures in the
//   orchestrator's recipe-sync tests, pointing nowhere near a build script.
//
// Widening the regex would have fixed that instance. It would not have fixed
// the next one. Keeping the banner unconditionally on the Node pass costs a
// few unused imports in files that never read them, which Node resolves for
// free, and removes the whole class.

// The browser pass has no banner, so `require` / `__dirname` / `__filename`
// are genuinely undefined in its output. Assert nothing there references them.
//
// This closes the one failure mode `smoke-browser.mjs` cannot see. If a
// Node-dependent module ever leaks into a browser-safe entry's graph, esbuild
// emits its interop helper:
//
//   var __require = ((x) => typeof require !== "undefined" ? require : Proxy-that-throws)
//
// That BUNDLES cleanly — no `node:*` import, so the browser smoke passes — and
// it IMPORTS cleanly, because `typeof` on an undeclared identifier is legal and
// the throwing branch is never evaluated at module scope. It fails only when
// something calls it, at runtime, in a consumer. That is precisely how 0.40.1
// shipped: green build, green smoke, 13 broken tests in another repo.
//
// A static check catches it at the only moment it is cheap to catch.
const leaked = [];
for (const outPath of Object.keys(browserResult.metafile.outputs)) {
  const body = readFileSync(outPath, "utf8");
  const hits = [...body.matchAll(/\b(require|__dirname|__filename)\b/g)].map((m) => m[1]);
  if (hits.length > 0) {
    leaked.push(`${outPath}: references ${[...new Set(hits)].sort().join(", ")}`);
  }
}
if (leaked.length > 0) {
  throw new Error(
    `Browser-safe ESM output references Node-only globals, which are undefined there:\n` +
      leaked.map((line) => `  - ${line}`).join("\n") +
      `\n\nA Node-dependent module reached a browser-safe entry. It will bundle and ` +
      `import fine and throw when called. Either drop the offending import from that ` +
      `entry's graph, or move the subpath out of BROWSER_SAFE_SUBPATHS above.`
  );
}

const outputs = Object.keys(result.metafile.outputs).length;
const browserOutputs = Object.keys(browserResult.metafile.outputs).length;
console.log(
  `[build-esm] node: ${nodeEntryPoints.length} entry point(s) → ${outputs} file(s); ` +
    `browser: ${browserEntryPoints.length} entry point(s) → ${browserOutputs} file(s) (no shim banner)`
);
