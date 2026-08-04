/**
 * ESM half of the dual-package smoke suite.
 *
 * `smoke-require.cjs` proves the CJS build loads under `require`. This proves
 * the ESM build loads under `import`, which is a genuinely different failure
 * mode: the CJS output can be perfectly healthy while the ESM output throws on
 * a bare `import` because a `require()`/`__dirname` shim is missing, a JSON
 * import lost its inlining, or an entry point silently emitted nothing.
 *
 * Three things are checked, in increasing order of subtlety:
 *
 *   1. Every `import` target declared in package.json `exports` exists on disk.
 *      Catches an entry that was added to the map but never built.
 *   2. Every one of them actually imports and exposes at least one binding.
 *      An entry that resolves to an empty module is a build failure that a
 *      file-existence check would happily pass.
 *   3. Shared modules keep a single identity across entry points. This is what
 *      `splitting: true` buys: without it every entry bundles its own copy, so
 *      a symbol reachable from two entries would be two different objects.
 *      Anything relying on `instanceof` across subpaths — most obviously
 *      `ScaiError` — breaks silently in that world, and nothing else in the
 *      suite would notice.
 */

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const entries = Object.entries(pkg.exports)
  .filter(([subpath, target]) => subpath !== "./package.json" && typeof target === "object")
  .map(([subpath, target]) => ({ subpath, file: target.import }))
  .filter((entry) => Boolean(entry.file));

if (entries.length === 0) {
  console.error("[smoke-import] no `import` conditions in package.json exports — nothing to check");
  process.exit(1);
}

let failures = 0;
const fail = (message) => {
  console.error(`[smoke-import] FAIL ${message}`);
  failures += 1;
};

// 1 + 2 — every declared ESM entry exists and yields a non-empty module.
const loaded = new Map();
for (const { subpath, file } of entries) {
  const absolute = resolve(file);
  if (!existsSync(absolute)) {
    fail(`${subpath}: declared import target missing on disk (${file})`);
    continue;
  }
  try {
    const mod = await import(pathToFileURL(absolute).href);
    const names = Object.keys(mod);
    if (names.length === 0) {
      fail(`${subpath}: imported but exposes no bindings`);
      continue;
    }
    loaded.set(subpath, mod);
  } catch (error) {
    fail(`${subpath}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}

// 3 — cross-entry module identity.
//
// The browser-safe schema entries are built in their own esbuild pass (see
// scripts/build-esm.mjs — it is the only way to keep a Node built-in out of
// their chunk graph), so anything reachable from BOTH passes is emitted twice.
//
// Measured, that is these two: pure `(value) => string`-shaped helpers with no
// identity contract. Nothing does `instanceof` on a function that maps a field
// type to a label. Every class and error type stays inside the Node pass and is
// still held to single-identity below.
//
// Do not grow this list to silence a failure. A duplicated CLASS or ERROR here
// is a real defect — it means `instanceof ScaiError` would return false across
// subpaths — and the fix is to move the module out of the browser pass, not to
// add a name here.
const IDENTITY_EXEMPT = new Set(["defaultSitecoreFieldType", "sitecoreFieldTypeLabel"]);

const seen = new Map();
let comparisons = 0;
let exempted = 0;
for (const [subpath, mod] of loaded) {
  for (const [name, value] of Object.entries(mod)) {
    // Only functions and classes carry identity that matters here; plain
    // values and re-exported literals can legitimately be duplicated.
    if (typeof value !== "function") continue;
    if (IDENTITY_EXEMPT.has(name)) {
      exempted += 1;
      continue;
    }
    const previous = seen.get(name);
    if (!previous) {
      seen.set(name, { subpath, value });
      continue;
    }
    comparisons += 1;
    if (previous.value !== value) {
      fail(
        `${name} is a different object in "${previous.subpath}" and "${subpath}" — ` +
          `shared modules were duplicated instead of split, so instanceof across ` +
          `subpaths will not hold`
      );
    }
  }
}

if (failures > 0) {
  console.error(`[smoke-import] ${failures} failure(s)`);
  process.exit(1);
}

console.log(
  `[smoke-import] ok — ${loaded.size} ESM entry point(s) imported, ` +
    `${comparisons} cross-entry identity comparison(s) held, ${exempted} exempt`
);
