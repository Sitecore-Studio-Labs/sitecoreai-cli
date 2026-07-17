---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Add a "compile once, apply many" seam to `recipe push` so a batch driver can compile a large recipe set once instead of recompiling it on every chunk.

`recipe push --from-compiled <dir>` loads a pre-compiled `.ir.json` set and skips compilation entirely — no `.recipe.ts` loading, no `compileRecipeSet`, no tenant-read compile inputs (media-root alignment, language resolution). Everything after the compile boundary (cross-recipe ref pre-seed, `--handles`/`--aggregates-only` scoping, apply) runs unchanged. Because scai compiles the full staged set regardless of `--handles`, a chunked install previously paid the full-set compile once per chunk; `--from-compiled` collapses that to a single upfront compile.

`recipe compile` gains `--output-dir <dir>` to collect the whole set flat as the artifact `--from-compiled` consumes, and — when given `-n <env>` — now resolves the same tenant-derived compile inputs a push would (the `--languages` installed-locale intersection and media-root alignment) so a precompiled artifact carries the same localized surface and media paths a compiling push produces.

Note: `--languages` is a compile-time scope baked into the IR, so it is a no-op on `--from-compiled` (a warning is emitted); `--from-compiled` also rejects `--provision-languages`. Compile per `--languages` scope you intend to apply.
