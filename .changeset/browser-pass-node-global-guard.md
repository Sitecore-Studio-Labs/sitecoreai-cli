---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Closes the last gap in the ESM build's guard rails.

`smoke-browser.mjs` (0.40.2) proves the browser-safe schema entries bundle without a Node built-in. It cannot see the other half of the problem, which is what shipped 0.40.1: if a Node-dependent module reaches one of those entries, esbuild emits its interop helper —

```js
var __require = ((x) => (typeof require !== "undefined" ? require : /* throwing Proxy */));
```

— and that **bundles cleanly** (no `node:*` specifier, so the browser smoke passes) and **imports cleanly** (`typeof` on an undeclared identifier is legal, and the throwing branch is never evaluated at module scope). It fails only when something calls it, at runtime, in a consumer's process. 0.40.1 was green on build, green on the full smoke chain, and broke 13 tests in the orchestrator.

The browser pass carries no shim banner by design, so `require` / `__dirname` / `__filename` are genuinely undefined in its output. `scripts/build-esm.mjs` now asserts that nothing there references them, and fails the build naming both the entry and the leaked chunk:

```
Error: Browser-safe ESM output references Node-only globals, which are undefined there:
  - dist/esm/sync/index.js: references __dirname
  - dist/esm/chunk-3RG5ZIWI.js: references require
```

(That output is from deliberately adding `./sync` to `BROWSER_SAFE_SUBPATHS` to confirm the check is not vacuous.)

This is a build-time check rather than a smoke, because the failure is invisible at both bundle time and import time — the only cheap moment to catch it is while the output is being written.
