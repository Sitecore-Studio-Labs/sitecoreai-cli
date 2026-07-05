---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix a load-time crash for CommonJS consumers of the recipe SDK introduced in 0.15.0. The media-template fix pulled in `mime@4`, which is ESM-only; the package's `tsc`-built CommonJS dist therefore emitted `require("mime")` against an ES module. Stock Node ≥20.19 tolerates that (`require(esm)`), but bundled serverless runtimes with custom module loaders (e.g. Vercel's) do not — any process that loaded `recipe/runtime/plan.js` crashed at require time with `ERR_REQUIRE_ESM`, taking down in-process SDK consumers entirely. Downgraded to `mime@3` (same `getType`/`getExtension` API, CommonJS), which loads under every module loader.
