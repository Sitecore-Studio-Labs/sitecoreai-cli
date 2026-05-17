---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Recipe sandbox: OS-level confinement via Node's permission model.**

The recipe sandbox isolated `.recipe.ts` execution in a child process with a
clean environment and a timeout. This change adds real OS-level confinement
on top, by restructuring how the child runs.

The child no longer compiles TypeScript. `.recipe.ts` is transpiled to a
self-contained CommonJS bundle in the trusted parent (via esbuild —
transpiling is not executing); the child runs only that plain JS. Because
the child needs no TypeScript toolchain, it is spawned under Node's
permission model with **no worker threads, no `child_process`, no filesystem
writes**, and filesystem reads scoped to the bundle. A hostile recipe can no
longer delete or corrupt files, spawn processes, or escape via a worker.

(The earlier in-child tsx approach could not be confined: tsx's transform
needs a worker thread, and `--allow-worker` is the grant Node itself warns
"could invalidate the permission model". Moving the compile to the parent
removes that need.)

`esbuild` is now a direct dependency. `SITECOREAI_RECIPE_SANDBOX=0` still
forces the legacy in-process load. See docs/recipe-sandbox.md.
