---
"@sitecoreai-labs/sitecoreai-cli": minor
---

The package now ships **both CommonJS and ESM**. Every SDK subpath gains an `import` condition resolving to a native ESM build in `dist/esm/`, alongside the existing CommonJS build.

This is purely additive. `dist/` is byte-for-byte what it was, and the `require`/`default` conditions point at exactly the same files as before — no path that resolves today changes. CJS consumers are unaffected; ESM consumers stop going through Node's CJS interop.

The point is unblocking dependency upgrades. The npm ecosystem is steadily going ESM-only on new majors, and a CommonJS-only build meant those majors could never merge — `mime` is still pinned at v3 for exactly this reason, and the `smoke-require` guard added after the 0.25.0 `ERR_REQUIRE_ESM` incident converted that breakage into a permanently red upgrade rather than removing the constraint.

The ESM half is built with esbuild (already a dependency) rather than a second `tsc` pass, because four things block plain `tsc` from emitting runnable Node ESM here: ~1178 `@/*` path aliases, 11 JSON imports that would need `with { type: "json" }` (which TypeScript won't emit under `module: CommonJS`, so the attribute cannot live in shared source), plus `__dirname` and `require()` usages that are valid in CJS and undefined in ESM. esbuild resolves the aliases, inlines the JSON, and the ESM output carries a banner shimming `require`/`__dirname`/`__filename`.

Code splitting is on, which matters for correctness rather than size: without it each of the 15 entry points would bundle its own copy of shared modules, so a class reachable from two subpaths would be two distinct objects and `instanceof ScaiError` would fail across them. A new `smoke-import.mjs` asserts that identity holds, alongside checking every declared `import` target exists and actually exposes bindings.

Cost is about 1.5 MB added to a 12 MB `dist/` (41 emitted files against 713 for CJS).
