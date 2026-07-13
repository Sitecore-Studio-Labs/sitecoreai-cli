---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): stop inline treelist children collapsing onto a single item

An inline child array (`fields: { Items: [ {…}, {…} ] }`) compiled to one
`CreateItem` per entry, but every one of them landed on the SAME Sitecore item —
so an N-entry treelist became one item overwritten N times, and the parent's
GUID list held the same GUID N times. A 7-entry nav rendered its last entry
seven times.

Cause: the planner's sibling fallback treats "exactly one sibling carrying this
recipe's `Scai Handle` marker" as proof the item was renamed. But the marker is
recipe-scoped — every item a recipe creates under a shared parent carries the
same one. So on a first push, `Items-2` missed on path and name, saw the single
marked sibling `Items-1` (created moments earlier in that same push), called it
a rename, and rebound onto it. The collapse then held the marked count at one,
so every later child did the same.

The fallback now knows which item names the push's own `CreateItem` ops claim
under each parent: a marked sibling whose name belongs to another op is that
op's item, not a rename of this one. A genuine rename still rebinds — a renamed
item's name is precisely the one no op claims.
