---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(recipe): `push --from-compiled` honors `--languages` as an apply-time locale filter

Previously `--languages` was ignored on `--from-compiled` (locale scope was fixed when the artifact compiled), so a batched install had to recompile the full recipe set per localize bin. Because the compiled IR already bakes per-locale writes as language-tagged ops (`AddItemVersion` + versioned `SetField`, plus per-language `__Final Renderings` guards), the scope can instead be applied at apply time as an op filter.

`push --from-compiled --languages <L>` now drops version-stack ops whose explicit `language` is out of scope (and out-of-scope per-language `CreateItem.fields` entries), while keeping every language-agnostic op (structure, shared fields, `SetBaseTemplates`/`SetStandardValues`, `CreateSiteFromTemplate` — whose `language` is the site's primary config, never a content locale — cross-recipe aggregates, prunes) and the always-applied default version. An `AddItemVersion` and its dependent versioned `SetField`s share a language, so they keep or drop as a unit; IRs left empty by the slice are dropped. Bare base languages cover their regional variants (`fr` matches `fr-CA`), matching the compiler's own scope semantics.

This lets a single all-language artifact drive both the en-first content push (`--languages en`) and every localize bin (`--languages <bin>`) with no per-phase recompile — the last un-deduplicated compile in the batched-install pipeline. An unscoped `--from-compiled` push still applies every baked locale; `--provision-languages` remains rejected with `--from-compiled`.
