---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): preserve topological apply order in the `--from-compiled` artifact

`recipe compile --output-dir` wrote one IR per recipe named `<handle>.ir.json`, and `push --from-compiled` reloaded them with a lexical `.sort()` — collapsing the set to **alphabetical-by-handle** order and discarding the topological apply order `compileRecipeSet` emits. A recipe referencing a handle that sorts after it (e.g. `ai-chat@1` → `ai-context-item@1` via a `source: { kind: "filter", types: [...] }` field) then applied **before** its referent, and its `ref-source-fields` op threw `references handle '…'; not yet in captured map`.

The `--output-dir` artifact now stamps each filename with a zero-padded apply-order index (`00014-<handle>.ir.json`), so the existing lexical `.sort()` in `resolveCompiledIrInputs` reproduces topological apply order. Referents apply before their referrers again. Only the flat `--output-dir` artifact is affected; single-`--output` and per-source `.scai/` IR paths are unchanged.
