---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `ERR_REQUIRE_ESM` crash on any recipe plan/push: the dependabot bump to `mime@4` (ESM-only) broke the CommonJS `dist/` build's `require("mime")` in `recipe/runtime/plan.js` at runtime — unit tests (TS source under vitest) and the spawn smokes never load that module, so it only surfaced in consumers. Reverted to `mime@3` (CJS-compatible, same `getType`/`getExtension` API) and added a require-graph smoke (`scripts/smoke-require.cjs`, wired into `pnpm smoke`) that `require()`s every built dist module from CJS so an ESM-only dependency bump anywhere in the graph now fails CI instead of production.
