---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `brand sync push` corrupting brand-kit fields by writing the wrong value shape.

Each recipe field value was written to Sitecore raw, ignoring the live field's `type`. The recipe value union is permissive (`string | object-array`), so an LLM-generated recipe can hand a plain string to a `richArray` field ("Tone scenarios", "Image style scenarios") or an object-array to a `text` field. Writing the mismatched shape corrupts the field — the Sitecore AI app then maps over a string (or renders an object as text) and the whole section page throws ("Tone of Voice / Image Style pages are broken").

`indexFields` already reads each field's `type` from the v2 fields API but dropped it. Thread it into `FieldTarget` and coerce in `toApiValue`:

- `text` → newline-joined string (flattens object-arrays)
- `array` → `[{ name }]`
- `richArray` → `[{ name, tags?, restrictions? }]`

A stray string is wrapped as a single entry; off-schema entries normalise to at least carry `name`. Unknown type (older API response without the discriminator) falls back to the legacy passthrough. Adds coercion tests for string → richArray wrap and object-array → text flatten.
