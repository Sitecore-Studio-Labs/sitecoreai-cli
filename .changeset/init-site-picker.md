---
"@sitecoreai-labs/sitecoreai-cli": patch
---

feat(setup): site picker in the init wizard + fix the auth hint

`scai setup init --wizard` now discovers the environment's SXA sites and offers
them as a **picker** — choosing one resolves both the site name and its
collection (parent tenant) in a single step, so recipeRoots derive with no typing.
Best-effort: if discovery is unavailable (no CM client yet) or the environment has
no sites, it falls back to the existing text prompt.

Also fix the `AUTH_REQUIRED` hint on the Authoring API: it pointed at
`scai setup env` (not a command) — it now points at `scai setup client create <env>`,
the command that actually provisions the CM automation client.
