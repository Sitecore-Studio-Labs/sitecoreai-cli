---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`src/sync/baseline.ts`: add tests for the kind-agnostic baseline helpers.

The new `stableStringify` + `hashJsonValue` + `classifyHashes` utilities
(used by brand / brief / campaign three-way merge alongside scai's
content-recipe baseline) shipped without tests. Add 21 unit cases
covering: stable key ordering (object reordering yields identical
hashes; array order preserved), nested + mixed-depth structures,
known-good SHA-256 vector for the canonical empty string, classify-
hashes truth table including the empty-string-baseline-vs-undefined
distinction.

No behaviour change — pure test addition. `src/sync` directory
coverage jumps from ~50% → 96.85% statements.
