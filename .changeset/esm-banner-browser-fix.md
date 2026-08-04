---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fixes the dual ESM build breaking browser bundlers.

0.40.0 shipped the dual CJS+ESM build with a banner that shims `require`, `__filename`, and `__dirname` into every emitted ESM file. esbuild applies `banner` to _all_ outputs — there is no per-file option — so all 41 emitted files opened with `import { createRequire } from "node:module"` when only 2 actually reference a shim.

That was not merely dead weight. A browser bundler resolving the new `import` condition reaches `dist/esm/`, hits `node:module` in a browser chunking context, and fails the build:

```
the chunking context (unknown) does not support external modules (request: node:module)
```

It surfaced in the showcase registry's production build, on the pure-Zod schema entries (`./recipe/schema`, `./unstable/brand/schema`, …) imported into a client component. Those entries contain no Node API usage at all — they were poisoned purely by the blanket banner. The CommonJS build carried no such marker, so this was a regression introduced by the dual build rather than a pre-existing constraint.

`scripts/build-esm.mjs` now strips the banner from every emitted file whose body never references `require(`, `__dirname`, or `__filename`. This is safe per-file because the three shims are file-local `const` declarations: a file that never reads them is unaffected by their removal, and the 2 files that do read them keep the banner verbatim. The Node-side behavior of the ESM build is unchanged — `smoke-import.mjs` still imports all 15 entry points and holds all 6 cross-entry identity comparisons.
