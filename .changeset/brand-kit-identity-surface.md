---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`brand sync push`: surface the resolved Sitecore brand-kit UUID via `--identities-out` + a new `"brand-kit"` scope on `ResolvedIdentity`.

Three coordinated changes so the orchestrator can stamp the real SAI-side brand-kit UUID onto its `brand_kits` row instead of carrying the recipe handle as a placeholder (and breaking downstream campaign pushes that need `brandkit_id`).

1. **`ResolvedIdentity.scope`** gains a `"brand-kit"` member. Previously the type-doc said brand-kit applies had nothing to surface ("the kit is identified by the brand UUID the caller already supplied") — but the caller is the orchestrator, and it identifies the kit by its own brand handle, not by the SAI UUID. Without surfacing the UUID, the orchestrator can't link it back.
2. **`brandKitKind.apply`** emits a single `"brand-kit"` identity in its `ApplyResult.identities` with the resolved kit UUID (and the kit's display name + the recipe handle, mirroring the campaign/brief identity shape).
3. **`scai brand sync push --identities-out <path>`** flag writes the apply outcome's identities as JSON to `<path>`, matching the campaign / brief sync surface. Operators reading the file get `{ identities: [{scope: "brand-kit", id: "<uuid>", name: "<display>", handle: "<recipe>"}] }`.

No behaviour change when the flag is omitted; brand-kit dry-runs continue to surface no identities. Mirrors the campaign-sync identity flow already wired through the orchestrator's brand-kit-deploy worker.
