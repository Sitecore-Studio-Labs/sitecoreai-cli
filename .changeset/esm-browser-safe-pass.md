---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fixes the broken ESM chunk shipped in 0.40.1, and removes the design that produced it.

**The immediate bug.** 0.40.1 stripped the `node:module` shim banner from ESM files that "don't need it", deciding need with `\brequire\s*\(` — the call form. That missed esbuild's own interop helper, which reads `require` as a _value_ and never calls it:

```js
var __require = ((x) => (typeof require !== "undefined" ? require : /* throwing Proxy */));
```

With the banner gone, `typeof require` evaluated to `"undefined"` — legal on an undeclared identifier, so nothing threw at import time — and execution fell through to the Proxy that throws on use. It surfaced as 13 failures in the orchestrator's recipe-sync pull-mode conflict classification, pointing nowhere near a build script. Same tree: 255/255 on 0.40.0, 13 failures on 0.40.1.

**Why widening the regex was not the fix.** Matching the bare identifier repairs that instance. It does not repair the next one, and it does not address why the stripping existed at all — which was to keep `node:module` out of browser bundles. Chasing that with a per-file heuristic was always treating a symptom: with `splitting: true`, esbuild hoists its helpers into a chunk shared by every entry, and the schema entries reach it through a bare side-effect import (`import "../../chunk-X.js"`, no bindings — invisible to a source grep, entirely visible to a bundler). One banner on that shared chunk poisons all five schema entries no matter how the stripping is tuned.

**What replaces it.** The browser-safe schema entries — `./recipe/schema` and `./unstable/{brand,brief,campaigns,agents}/schema` — now build in their own esbuild pass with no banner, so no Node built-in can reach them through a shared chunk. The Node pass keeps the banner unconditionally. There is no per-file stripping left to get wrong.

Cost: modules reachable from both passes are emitted twice. Measured, that is two pure helpers (`defaultSitecoreFieldType`, `sitecoreFieldTypeLabel`) with no identity contract. Every class and error type stays in the Node pass, so `instanceof ScaiError` still holds across subpaths — `smoke-import.mjs` enforces that and exempts exactly those two by name.

**New gate: `scripts/smoke-browser.mjs`.** Bundles each browser-safe entry with esbuild at browser platform, where `node:*` cannot resolve. This reproduces the 0.40.0 failure directly, and fails on 0.40.1's output too.

That gap was real and it cost two releases. `smoke-import.mjs` imports every entry under **Node**, where `node:module` resolves fine — "does it load" was never the question; "does it load somewhere without Node built-ins" was. Note the related limit that let 0.40.1 through: importing a module that merely _defines_ a broken helper succeeds, and only calling it throws, so an import-level check cannot catch that class either. The orchestrator's unit tests were what caught it.

Verified with this build installed in both consumers: orchestrator 825/825 recipe-sync tests, showcase production build clean, full `pnpm smoke` green.
