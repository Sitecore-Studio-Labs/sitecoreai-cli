---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `recipe-push` failure on dictionary translations: emit `AddItemVersion`
before each per-locale phrase write.

`compileDictionaryRecipe` created each entry with only its primary-locale
version, then emitted a `SetField` for every translation locale. In Sitecore
you can't set a field on a language version that doesn't exist yet, so the
push aborted with:

```
Authoring GraphQL errors: The item '<id>' does not contain version #1 in 'de' language
```

The compiler now emits an `AddItemVersion` for each translation locale before
its `Phrase` `SetField` (mirroring how content-item and page recipes
materialise non-primary language versions). The executor creates the language
version as part of adding version 1, and re-pushes stay idempotent (the
planner skips versions that already exist).
