---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Rollback now names the residue left behind by warn-only compensating steps instead of reporting it as "no inverse needed (no forward mutation)".

Four rollback kinds are deliberately not inverted — `createSite` (deleting a site cascades destructively), `ensureLanguages` (registration is additive and environment-wide), `addItemVersion` (no `deleteItemVersion` inverse exists), and `mediaUpload` (an upload can re-use an existing item, so a delete could remove something the push didn't create). All four returned the same null inverse as an action that never mutated anything, so a half-failed push reported them identically: nothing happened. Something did happen, and the reasoning for leaving it lived only in source comments an operator would never see.

Each now reports the specific artifact left on the tenant — site name, language codes, media path, or item id + language + version count — along with why it wasn't undone and how to resolve it. The residue was always recoverable by hand; it just wasn't discoverable. Actions that genuinely applied no mutation keep the original wording.

Most relevant to `AddItemVersion`, since all version-adds run before any field writes: a push that fails in the field-write phase can leave versions unpopulated. Re-pushing repairs them (the planner skips the add once the version exists and the `SetField` ops fill it in), so the message points at that rather than implying manual cleanup is required.
