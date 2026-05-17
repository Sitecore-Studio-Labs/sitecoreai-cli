---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`brand`, `brief`, and `sites` move to the unstable surface.** All three
are reverse-engineered from observed traffic and not yet settled enough to
carry the 0.1.0 SemVer stability promise, so they join `agents` and
`campaigns` under the `./unstable/` namespace.

**Breaking — SDK subpath exports renamed:**

- `@sitecoreai-labs/sitecoreai-cli/brand` → `.../unstable/brand`
- `@sitecoreai-labs/sitecoreai-cli/brief` → `.../unstable/brief`
- `@sitecoreai-labs/sitecoreai-cli/sites` → `.../unstable/sites`

The old subpaths are removed, not aliased — update imports. The exported
symbols and their behavior are unchanged; only the import path moves. The
recipe planner's pinned subset of the Sites API (reached via
`createSitesApiClient` on the stable `./recipe` entry) is unaffected.

**CLI:** `scai brand`, `scai ops brief`, `scai ops campaign`, and
`scai agents` are now flagged as unstable surfaces. Each carries an
`[unstable]` tag in `--help`, appends a stability note, and prints a
one-line stderr warning on every invocation — reverse-engineered, no
SemVer stability promise.

**MCP:** the brand / brief / campaign / agents tool descriptions lead with
an `[unstable]` tag so an agent sees the stability signal before selecting
the tool.

The stable SDK core is now `./recipe`, `./deploy`, `./serialization`,
`./errors`, `./envelope`, `./config`, `./publishing`, `./content`,
`./hygiene`, `./webhooks`, `./workflow`, and `./sync`.
