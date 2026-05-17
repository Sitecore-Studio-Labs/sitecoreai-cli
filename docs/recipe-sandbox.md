# Recipe execution sandbox

`.recipe.ts` files are TypeScript that scai loads to read the recipe they
export. Loading one used to mean `require()`-ing it **in scai's own
process** — arbitrary code execution with scai's full privileges (the
filesystem, `process.env`, the OS keychain, the network, `child_process`)
from a file a weaponized config could point the `recipes` glob at; merely
listing or compiling recipes would run it.

Recipe loading is now a two-process design that both isolates that code and
confines it at the OS level.

## The contract that makes this clean

A `.recipe.ts` is not a program — it is a TypeScript file that **exports a
declarative `Recipe` object**. The recipe's effect happens later, when
`executeIr` interprets the compiled IR against a tenant; the `.recipe.ts`
itself only computes and exports data, and that data is pure and fully
JSON-serialisable (no functions — verified across every recipe kind in
`src/recipe/schema/recipe.ts`).

So loading splits into two steps with a narrow contract between them:
**compile** (`.recipe.ts` → JS — pure, no execution) and **run** (the JS
executes and produces the `Recipe` object).

## Design — transpile in the parent, run in a confined child

```
parent: esbuild compiles + bundles .recipe.ts -> one self-contained .cjs
              |  (transpiling is not executing)
              v  write the bundle to a temp file
parent -- fork(recipe-runner.cjs, [bundle], clean env, permission flags) --> child
                                                                             |
                child: require(bundle) - read the exported recipe            |
                                                                             |
parent <--------------- recipe object over the IPC channel ------------------+
   parent: validate against RecipeSchema (unchanged)
```

The compile step (`src/recipe/sandbox/transpile.ts`) runs in the **trusted
parent** — esbuild reads and rewrites the source, it never runs the recipe.
The run step (`src/recipe/sandbox/recipe-runner.cjs`) runs in a **forked
child** that only `require()`s the pre-compiled bundle. Because the child
needs no TypeScript toolchain, it can be locked down — see below. Only the
exported recipe (plain data) crosses back, re-validated against the Zod
schema.

`.recipe.json` needs none of this — it is parsed with `JSON.parse`, no code
runs. That path is unchanged.

## Confinement of the child

- **Node permission model** — the child is spawned with `--permission`
  (`--experimental-permission` before Node 23.5): **no filesystem writes, no
  `child_process`, no worker threads**, and filesystem reads scoped to the
  child script and the one bundle file. A hostile recipe cannot delete or
  corrupt files, spawn a process, or escape through a worker.

  This works only because the child runs plain pre-compiled JS. Running tsx
  in the child — the earlier design — needs `--allow-worker` (tsx's esbuild
  transform uses a worker thread), and Node itself warns that grant "could
  invalidate the permission model". Moving the compile into the trusted
  parent is what removes that need.

- **Clean environment** — the child gets a small allowlisted `env`, never
  scai's `process.env`. No tokens or secrets to read or exfiltrate.
- **Timeout** — a recipe that hangs is `SIGKILL`ed; the parent surfaces a
  clear error instead of hanging.
- **Crash isolation** — a recipe that throws or calls `process.exit` takes
  down only the child.

### Out of scope

- **Network egress** is not blocked — Node's permission model has no network
  switch. Acceptable: the child holds no secrets, cannot read outside the
  bundle, and its only output is `Recipe` data re-validated against the
  schema — there is nothing to steal and no way to inject behaviour.
- **The `recipes` glob redirection** itself is unchanged — the sandbox
  confines what a loaded recipe can _do_, not which files match the glob. A
  recipe-file trust pin was considered and deferred.

## Escape hatch

`SITECOREAI_RECIPE_SANDBOX=0` forces the legacy in-process load — for
debugging a recipe, or a runtime where spawning fails. The sandbox is on by
default.

## Testing

`tests/unit/recipe/sandbox.test.ts` — a benign recipe round-trips through the
child; a recipe that throws surfaces a clean error; a recipe that hangs is
killed by the timeout; a recipe that reads a stripped secret env var sees
`undefined`; and a recipe that attempts a filesystem write is refused by the
permission model (and the file is never created).
