---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Revert ESM-only dependency majors that crash strict-CJS consumers of the
SDK surface: mime back to v3 and uuid back to v11 (last dual-format
major; v5 GUID output is identical per RFC 4122). mime ≥4 is ESM-only
while dist/ is CommonJS — `require("mime")` in
`dist/recipe/runtime/plan.js` crashed any strict-CJS consumer with
`ERR_REQUIRE_ESM` (took down the orchestrator's dev environment via the
0.32.0 repin, a repeat of the 0.25.0 incident). The require-graph smoke
now walks the library surface with `--no-experimental-require-module`
so Node ≥22.12's require(esm) support can't mask this class of break in
CI again (the Commander-based executable surface stays engines-gated),
and dependabot ignores mime/uuid major bumps until dist ships ESM.
