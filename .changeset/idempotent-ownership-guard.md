---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): idempotent-by-default ownership guard + ignore inherited `Scai Handle` markers

Re-installing a recipe set onto an environment that already has it produced spurious `Name collision: item '…' is owned by recipe 'X', not 'Y'` aborts (exit 6). Two causes, both fixed:

**Inherited markers.** `Scai Handle` is a SHARED field, so a recipe that stamps it on a component template's `__Standard Values` makes every datasource item built on that template INHERIT the component's handle. A page's scoped-datasource item (`sync-home@1` → `HeroMonarch`) therefore read as "owned by `hero@1`". The ownership read now fetches `containsStandardValue` and treats an inherited value as **unmarked** — ownership is an item's OWN marker, never one inherited from Standard Values.

**Idempotent-by-default guard.** A live item whose own owner marker differs from the current op's is almost always the _same content re-installed_ after the compile order or recipe set shifted — shared infra materialised by whichever recipe compiled first (pre-aggregate migration), an item that moved between recipes across set versions, etc. — not a genuine two-recipes-collide bug. Aborting broke every re-push against an environment with history. The guard now **adopts the live item + re-stamps ownership** to the current op's marker (converging on the current set as the authority, last-writer-wins) instead of failing the install. The one case still treated as a hard error: two _different_ synthetic `__…__` aggregates claiming the same item — a compiler wiring bug, not tenant history.

Net: re-installing the same set is idempotent, and the pre-aggregate/enum-template migration adoptions are now the general path rather than special cases.
