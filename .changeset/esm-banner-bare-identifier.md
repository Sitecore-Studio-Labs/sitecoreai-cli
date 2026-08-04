---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fixes a broken ESM chunk shipped in 0.40.1.

0.40.1 stripped the `node:module` shim banner from ESM files that don't need it, to stop browser bundlers choking on it. The test for "needs it" was `\brequire\s*\(` — the call form. That missed esbuild's own interop helper, which reads `require` as a _value_ and never calls it:

```js
var __require = ((x) => typeof require !== "undefined" ? require : /* throwing Proxy */)
```

With the banner gone, `typeof require` evaluated to `"undefined"` — legal on an undeclared identifier, so no `ReferenceError` at import time — and execution fell through to the Proxy branch that throws on use. `require.resolve(…)` would have slipped through the same gap.

The failure surfaced as 13 unrelated-looking test failures in the orchestrator's recipe-sync pull-mode conflict classification, with nothing pointing at a build script. It reproduced cleanly: the same tree passed 255/255 on 0.40.0 and failed 13 on 0.40.1.

The check now matches the bare identifier, `\b(?:require|__dirname|__filename)\b`, which is what the shims actually are. Word boundaries mean it does not fire inside `__require` or on `required`, so the pure-Zod schema entries the browser fix targets are still stripped — 6 of 41 files keep the banner now, against 2 before, and `dist/esm/recipe/schema.js` is still clean.

Verified against both consumers: the orchestrator's 255 recipe-sync tests pass again, and the showcase production build still completes with zero chunking errors.

Note for whoever touches this next: `pnpm smoke` passed on the broken 0.40.1. `smoke-import.mjs` imports every entry point, and importing a module that merely _defines_ a broken helper succeeds — only calling it throws. The import-level guard cannot catch this class on its own; the orchestrator's unit tests were what caught it.
