---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix the recurring `ERR_REQUIRE_ESM` break in strict-CJS consumers (the orchestrator's Vercel functions) — and make it structurally unrepeatable.

- Removed the `mime` dependency (ESM-only at v4, twice shipped via dependabot majors): the media-upload planner now uses an internal media-type table with byte-identical outputs for every format Sitecore's media library handles.
- Removed the `uuid` dependency (same ESM-only failure mode, caught by the new guard before it shipped): scai only used RFC 4122 v5, now an internal `node:crypto` implementation with byte-identical output — every pinned refKey derivation in the test suite proves parity, so recipe identity is unchanged.
- Hardened `scripts/smoke-require.cjs` into a two-pass guard: the SDK-consumable graph is walked under `node --no-experimental-require-module` (reproducing loaders without `require(esm)` support — modern Node's native `require(esm)` is exactly how the second mime bump passed CI while production broke), plus a full-dist walk under default semantics for the CLI tree (which runs in scai's own process, engines ≥ 22.12, where ESM-only deps like commander are fine). The strict pass refuses to run without the flag.
