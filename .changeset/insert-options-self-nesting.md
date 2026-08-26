---
"@sitecoreai-labs/sitecoreai-cli": patch
---

**`validateRecipeSet` no longer reports a template that nests inside itself as a cycle.**

A template listing its own handle in `insertOptions` is the ordinary Sitecore shape for "this item type may be nested inside itself" — an accordion inside an accordion, a nav group inside a nav group. It compiles to a single Insert Options entry on `__Standard Values` like any other entry.

`detectInsertOptionsCycles` was a plain DFS with no self-edge case, so it reported the self-reference as an `a@1 → a@1` cycle. That made `isValid()` false — and `validateRecipeSetOrThrow` hard-stop — for whole recipe sets whose only offence was a legal nesting declaration, with no fix available except deleting the nesting.

A self-edge also constrains no ordering between distinct recipes, which is why the compiler's own `topoSortGroup` already drops it explicitly (`depIdx === i`). The detector now matches that.

Genuine rings are unaffected: `a → b → a` is still reported, including when `a` also self-nests.
