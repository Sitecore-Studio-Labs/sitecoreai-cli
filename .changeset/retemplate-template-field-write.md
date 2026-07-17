---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix the v0.34.1 adopt-and-retemplate regression that aborted recipe pushes on repeat installs.

Two fixes:

- **Retemplate mechanism**: the Authoring GraphQL schema has no `UpdateItemInput.templateId` (sending one fails variable coercion — "The value of $input has a wrong structure") and no changeTemplate mutation. The template change now rides a `__Template` system-field write through the normal `updateItem` fields channel (the same path `__Renderings`/`__Masters` writes use), as a Sitecore-formatted braced ID.
- **Eligibility**: adopt-and-retemplate now also requires the CreateItem op to seed at least one authored field beyond the injected `Scai Handle` marker. Recipe-created grouping folders (e.g. `enumerations-grouping-folder`) use per-site custom folder templates the built-in folder-class exclusion can't enumerate, and their cross-seed twins mismatch by construction — they now keep the v0.33.0 lossless adopt-as-is behavior instead of being retemplated (previously: `article-card-variant@1: enumerations-grouping-folder:default:Card ... retemplating it failed` aborting batch-1).
