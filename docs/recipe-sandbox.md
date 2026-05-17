# Recipe execution sandbox (Phase 4)

`.recipe.ts` files are TypeScript that scai compiles and `require()`s. Until
Phase 4 that happened **in scai's own process** — so loading a recipe ran
arbitrary code with scai's full privileges: the filesystem, `process.env`
(which can hold deploy tokens and client secrets), the OS keychain, the
network, `child_process`. A weaponized `sitecoreai.cli.json` can redirect
the `recipes` glob at a hostile `.recipe.ts`; merely _listing_ or _compiling_
recipes would then execute it.

Phase 4 moves `.recipe.ts` loading **out of process**.

## The contract that makes this clean

A `.recipe.ts` is not a program — it is a TypeScript file that **exports a
declarative `Recipe` object**. The recipe's effect comes later, when
`executeIr` interprets the compiled IR against a tenant; the `.recipe.ts`
itself only computes and exports data. That data is **pure and fully
JSON-serialisable** — no functions, no class instances (verified across
every recipe kind in `src/recipe/schema/recipe.ts`).

So the loading contract is narrow: **file path in → `Recipe` JSON out.** The
untrusted code can run in an isolated child; only validated _data_ crosses
back.

## Design — child process

`loadRecipeFromTypeScript` (`src/recipe/io.ts`) no longer `require()`s the
recipe. It forks a child:

```
parent ── fork(recipe-loader, [<recipe-path>], clean env) ──▶ child
                                                               │
        child: register tsx · require(<recipe-path>)           │
                                                               │
parent ◀──────── recipe object over the IPC channel ───────────┘
   parent: validate against RecipeSchema (unchanged)
```

The child — `src/recipe/sandbox/recipe-loader.ts` — registers the tsx require
hook, `require()`s the one recipe path passed as `argv[2]`, and sends the
exported recipe object back over the fork IPC channel. IPC uses structured
clone, so only plain data crosses — a recipe that exported a function would
be rejected at the boundary. The parent (`src/recipe/sandbox/load.ts`)
re-validates whatever arrives against the Zod schema.

### Confinement of the child

- **Clean environment** — the child receives a small allowlisted `env`
  (`PATH`, `HOME`/`USERPROFILE`, the temp-dir vars, Windows `SystemRoot`),
  **never scai's `process.env`**. A hostile recipe finds no tokens or
  secrets to read or exfiltrate. This is the highest-value control.
- **No keychain** — the child only loads the recipe; scai's keychain code is
  never imported into it.
- **Timeout** — a recipe that hangs is killed (`SIGKILL`) after a bounded
  wait; the parent surfaces a clear error instead of hanging.
- **Crash isolation** — a recipe that throws, or calls `process.exit`, or
  segfaults a native addon, takes down only the child. Before Phase 4 it
  took down scai.

The child still runs as the same OS user as scai, so it _can_ touch the
filesystem and spawn processes. What it cannot do is read scai's secrets or
take scai down — and its only output is data re-validated against the schema.

### Out of scope / follow-up

- **OS-level confinement** — spawning the child under Node's permission
  model (`--permission` / `--experimental-permission`, to block filesystem
  writes and `child_process`) is a worthwhile hardening layer, but the
  flag-name churn across Node 20–23 and the `--allow-fs` allow-listing that
  tsx's compile cache needs make it its own tuning exercise. Deferred.

- **Network egress** is not blocked — Node's permission model has no network
  switch. This is acceptable: the child holds no secrets (clean env) and its
  only output is `Recipe` data re-validated against the Zod schema, so a
  hostile recipe has nothing to steal and cannot inject behaviour. Blocking
  egress would need OS-level controls (a sandboxed user, a container).
- **The `recipes` glob redirection** itself (a weaponised config pointing
  the glob elsewhere) is unchanged — the sandbox confines what a loaded
  recipe can _do_, not which files match. A recipe-file trust pin was
  considered and deferred.
- **`.recipe.json`** needs no sandbox — it is parsed with `JSON.parse`, no
  code runs. That path is unchanged.

## Escape hatch

`SITECOREAI_RECIPE_SANDBOX=0` forces the legacy in-process load — for
debugging a recipe, or a constrained runtime where spawning fails. The
sandbox is **on by default**; disabling it logs a one-line warning.

## Testing

`tests/unit/recipe/sandbox.test.ts` — a benign recipe round-trips through the
child; a recipe that throws surfaces a clean error; a recipe that hangs is
killed by the timeout; a recipe that reads a stripped secret env var sees
`undefined`. The child script is exercised against fixture `.recipe.ts`
files under `tests/unit/recipe/_fixtures/`.
