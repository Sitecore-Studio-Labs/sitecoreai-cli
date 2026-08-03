---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`scai/scripting` gains a `subtree` helper namespace, starting with `subtree.move` — relocate an item to a new parent, preserving its `itemId`, its name, and every inbound reference. This is the scripting-side counterpart to `scai content move`, for the cases the CLI shape doesn't fit: moving many items in one pass, computing the destination from a query, or composing a move with other surgery in one script.

It follows the same safe-by-default contract as the `multilist` helpers — `allowWrite` defaults to `false`, so the helper resolves both ends and reports what would happen without writing. Both ends resolve before anything is written, so a mistyped path fails with a typed `INPUT_INVALID` naming the side that didn't resolve rather than a generic GraphQL error. A move to the parent the item already has reports `changed: false` and makes no wire call.

`connect()` now also exposes an `authoring` client (the typed `AuthoringApiClient`) alongside `hygiene`, so scripts can reach Authoring operations — including `moveItem` — without re-implementing env resolution and auth.
