---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Replace adopt-and-retemplate with real twin convergence — fixes the repeat-install aborts (`retemplating it failed: ... Cannot find a field with the name __Template`).

The Authoring GraphQL API has **no template-change surface at all**: `UpdateItemInput.templateId` doesn't exist (v0.34.1's abort), there is no changeTemplate mutation, and `__Template` is not a writable field (v0.34.2's abort, observed live). A template-mismatched name-twin therefore cannot be conformed in place. Adoption now converges by what the twin actually is:

- **Same-shape twin** (its live template resolves every authored field name the recipe seeds — the cross-seed case, e.g. shared Data-folder items from another site-GUID family, and folder-ish items whose ops carry only system fields like `__Masters`): **adopt as-is** — field-by-name writes succeed against it, nothing needs to change.
- **Broken twin** (live template can't resolve the recipe's authored fields) that carries a matching `Scai Handle` marker and has no children: recipe-managed residue from an earlier partial/rolled-back install — **delete and recreate** with the expected template (the only convergence the API supports; the GUID changes, acceptable for residue that never worked).
- **Anything else** (no matching marker, or has children): never destructive — a precise actionable error naming the item, both templates, and the unresolvable fields.

Planner eligibility is tightened the same way: ops seeding only system/marker fields (site data folders with insert options, grouping folders) never enter the convergence path and keep the historical lossless adopt-as-is. `UpdateItemInput.templateId` is removed (it never worked against any live schema).
