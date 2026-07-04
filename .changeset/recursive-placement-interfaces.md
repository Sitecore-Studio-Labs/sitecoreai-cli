---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Nested placements: recursive interface-backed schema (fixes consumer TS2589).

0.14.0's `ComponentPlacementSchema` expressed nesting as four explicitly
tiered object schemas. Declaration emit inlined the tiers structurally into
every consuming schema's `.d.ts`, so downstream repos hit "Type instantiation
is excessively deep and possibly infinite" (TS2589) the moment they inferred
the page or content-item output types — the registry could not even typecheck
against the release.

`ComponentPlacement` / `ComponentPlacementInput` are now hand-declared
recursive interfaces backing a `z.lazy` schema with an explicit `z.ZodType`
annotation: emitted declarations reference the named interfaces (lazily
resolved, cacheable) instead of an inlined structural tree. Nesting depth is
now unbounded — the 4-level cap and its `INPUT_INVALID` depth guard are gone,
and deeper trees compile to correspondingly deeper dynamic-placeholder key
paths. Runtime validation behavior is unchanged.
