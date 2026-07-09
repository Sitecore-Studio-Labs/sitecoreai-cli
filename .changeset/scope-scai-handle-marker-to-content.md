---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `recipe push` aborting on template recipes with `Authoring GraphQL errors: Cannot find a field with the name Scai Handle`. The 0.28.7 marker fix stamped the `Scai Handle` identity field onto every `CreateItem` op, but template-authoring items (a template and its Template Sections / Template Fields) do not carry that field — it lives on the Standard Template, which content items inherit but template-authoring items do not — so the create aborted. `injectHandleMarker` now skips ops whose `templateOf` is a Sitecore template-system template (`Template`, `Template Section`, `Template Field`); content items (enumerations, datasources, pages, designs) still get the marker, and templates keep their path/name identity as before.
