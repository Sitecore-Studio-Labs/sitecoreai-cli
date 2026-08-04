---
"@sitecoreai-labs/sitecoreai-cli": major
---

**Breaking: the CommonJS build is gone. `dist/` is now ESM only.**

This closes #218, which has been open since the 0.25.0 `ERR_REQUIRE_ESM` incident. The dual build in 0.40.0 added an ESM path but left the CJS constraint in place; this removes it.

**What this buys.** ESM-only dependency majors can merge. That was #218's headline criterion and the only one still unmet — `mime@4` was the original trigger, and the ecosystem has kept going that way. Verified by making `ora` (ESM-only) a static top-level import instead of the lazy `await import()` it needed before: builds and runs. The lazy import is retained, since it also helps startup time, but it is no longer _required_.

`scripts/smoke-require.cjs` is deleted along with the constraint it enforced. It was always a tripwire rather than a fix — it converted production crashes into CI failures without removing the reason for either.

**Who is affected.** Anyone doing `require("@sitecoreai-labs/sitecoreai-cli/...")`. Both first-party consumers were already resolving the ESM half before this change — demo-orchestrator via `"type": "module"` + NodeNext, sitecoreai-showcase via `moduleResolution: bundler` — so neither is affected. The CLI binary is spawned and format-agnostic. External CJS consumers must switch to `import`, or to a dynamic `await import()`.

**How it is built.** `tsc` now emits declarations only (`emitDeclarationOnly`) and esbuild emits all JS. Going through `tsc` for ESM output would have meant `moduleResolution: NodeNext`, which requires explicit `./foo.js` in ~1186 source imports and abandoning the `@/*` aliases. esbuild resolves aliases, inlines JSON, and handles the rest, so the source is untouched.

**Source changes, all small.** `__dirname` in the sandbox loader now derives from `import.meta.url`; `require("node:crypto")` in `sync/baseline.ts` is a static import; the three JSON imports carry `with { type: "json" }`; and `sync/typescript-recipe.ts` constructs an explicit `createRequire(import.meta.url)`. That last one is deliberate and permanent — it hands a user's `.recipe.ts` to tsx's **CJS** hook, which is what provides a synchronous load and an addressable `require.cache` we can evict per file. The ESM hook has neither.

**One subtle trap worth recording.** Marking the package `"type": "module"` changes how a NodeNext consumer reads the emitted `.d.ts`: they become ES-module declarations, where extensionless relative specifiers do not resolve. `export * from "./schema"` then silently degrades every re-exported type to `any` — and it does not error at the import site. It surfaced as a single unrelated-looking `TS7006: Parameter 'd' implicitly has an 'any' type` in a `.some()` callback in demo-orchestrator, several hops away.

`tsc-alias --resolve-full-paths` does not cover it — that rewrites the `@/*` alias specifiers and leaves plain relative ones alone. `scripts/fix-declaration-extensions.mjs` runs after and adds the extensions, resolving each against the filesystem so a directory import becomes `/index.js`. It rewrote 1215 specifiers across 461 of 713 declaration files.

**Verification.** CLI: 6627 tests, full smoke chain (`smoke`, `smoke-exports`, `smoke-import`, `smoke-browser`, `smoke-mcp`), and `scai --version` from the installed bin. Consumers, against a real `npm pack` tarball rather than a copied `dist/`: demo-orchestrator typechecks with **0 errors — matching its CommonJS baseline exactly** — and passes **8131 tests**.
