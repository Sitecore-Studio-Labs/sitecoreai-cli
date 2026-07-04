---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Page recipes now install into the real site tree and keep their nested content.

- `{site}` in a `PageRecipe.itemPath` is substituted with the active site's
  content-tree segment `<siteCollection>/<site>` (derived from the env
  profile's `site` + `siteCollection`), instead of the GUID-seed site — which
  defaulted to the literal `default` and silently created pages under a
  phantom `/sitecore/content/default/` tree no site serves. Compiling a
  `{site}` itemPath with no site configured now throws `INPUT_INVALID` with a
  pointer at the env profile, instead of succeeding into the wrong place.
- `ComponentPlacement` supports nested placements: `placement.placeholders`
  hosts children under a layout component's logical placeholder names
  (`column-1`, `column-2`), up to 4 levels deep. `compilePageRecipe` flattens
  the tree into SXA dynamic-placeholder wire form — the parent placement is
  assigned a page-unique integer `DynamicPlaceholderId` rendering parameter
  and children land in path-qualified keys
  (`/headless-main/column-1-1`) — and materialises nested scoped datasources
  under `<page>/Data/<slot>` exactly like top-level ones. Previously the
  schema silently STRIPPED nested placements, so installed pages lost every
  component (and its content) placed inside a column-splitter or similar
  layout component. Cross-recipe validation and topo-sort now walk nested
  placements too; partial-/page-design layouts reject nesting loudly.
- Fixed a race in the `.recipe.ts` sandbox loader: the child's IPC result
  message could lose against its own `exit` event, failing successful loads
  with a spurious "recipe sandbox exited unexpectedly (code 0)". The exit
  handler now gives a queued message a short grace window before rejecting.
