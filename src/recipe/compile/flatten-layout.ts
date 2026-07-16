import type { Layout } from "../schema/recipe";

/**
 * Nested-placement flattening — the recursive authoring shape
 * (placements hosting children in `placement.placeholders`) turned into
 * the flat SXA dynamic-placeholder wire shape the layout emitter
 * consumes.
 *
 * Shared by every layout-holding compiler that supports composition:
 * pages (`./page`), partial designs (`./partial-design`), and page
 * designs (`./page-design`). All three flatten with the SAME key
 * derivation, so a shell component (e.g. a `footer@1` exposing
 * `footer-main-{*}` / `footer-bottom-{*}` slots) composes identically
 * whether it is placed on a page or in design chrome:
 *
 *  - EVERY placement gets an item-unique integer `DynamicPlaceholderId`
 *    rendering parameter (author-set values are respected and never
 *    re-assigned; assigned ids skip any value an author already used).
 *    XM Cloud Pages assigns one to every rendering it places; SXA
 *    Headless components additionally read it to construct their
 *    dynamic placeholder names.
 *  - Each child group keyed by a LOGICAL name (`column-1`) lands in the
 *    path-qualified concrete key
 *    `/<parent-placeholder-path>/<name>-<DynamicPlaceholderId>` — e.g.
 *    `/headless-main/column-1-1` — the key XM Cloud Pages writes when
 *    an author drops a component into a dynamic placeholder, so
 *    recipe-seeded and author-added children coexist in one layout.
 *
 * Depth is unbounded — each level's children re-qualify against their
 * parent's (already concrete) key. Assignment is declaration-order
 * deterministic, and placement UIDs derive from the concrete key
 * (`layout/emit.ts`), so repeat pushes emit byte-identical XML.
 */

/** One placement in a layout (post-parse, recursive authoring shape). */
type Placement = Layout["placeholders"][string][number];

/**
 * Create a flattener whose `DynamicPlaceholderId` counter spans every
 * layout in `layouts` — ids are unique per ITEM, mirroring SXA's
 * per-page assignment, so a recipe declaring several layouts (a page's
 * item-level + per-version cells) can never mint a key that collides
 * across them. Author-set ids are pre-scanned across all the layouts
 * and never re-minted.
 *
 * Callers with a single layout can use the `flattenLayout` convenience
 * export instead.
 */
export const createLayoutFlattener = (layouts: readonly Layout[]): ((layout: Layout) => Layout) => {
  // Pre-scan author-set DynamicPlaceholderId values across every layout
  // so assigned ids never collide with them.
  const usedIds = new Set<string>();
  const scan = (placements: readonly Placement[]): void => {
    for (const placement of placements) {
      const authored = placement.params?.DynamicPlaceholderId;
      if (authored) usedIds.add(authored);
      for (const children of Object.values(placement.placeholders ?? {})) scan(children);
    }
  };
  for (const layout of layouts) {
    for (const placements of Object.values(layout.placeholders)) scan(placements);
  }

  let nextId = 1;
  const takeId = (): string => {
    while (usedIds.has(String(nextId))) nextId += 1;
    const id = String(nextId);
    usedIds.add(id);
    return id;
  };

  return (layout: Layout): Layout => {
    const out: Record<string, Placement[]> = {};
    const emit = (key: string, placements: readonly Placement[]): void => {
      const flat: Placement[] = [];
      const childGroups: Array<{ key: string; placements: readonly Placement[] }> = [];
      for (const placement of placements) {
        const { placeholders: children, ...rest } = placement;
        // EVERY placement gets an item-unique DynamicPlaceholderId — not
        // just the ones hosting children. XM Cloud Pages assigns one to
        // every rendering it places (operator-verified across working
        // tenant pages), and the Pages editor relies on it to key the
        // rendering instance; leaf renderings without one are part of
        // what the editor rejects as malformed.
        const dynamicPlaceholderId = rest.params?.DynamicPlaceholderId ?? takeId();
        flat.push({
          ...rest,
          params: { ...(rest.params ?? {}), DynamicPlaceholderId: dynamicPlaceholderId },
        });
        if (children && Object.keys(children).length > 0) {
          // Child keys are path-qualified against the parent's own
          // (already-concrete) key; the top level stays unqualified so
          // existing single-level layouts emit byte-identical XML.
          const parentPath = key.startsWith("/") ? key : `/${key}`;
          for (const [childName, childPlacements] of Object.entries(children)) {
            childGroups.push({
              key: `${parentPath}/${childName}-${dynamicPlaceholderId}`,
              placements: childPlacements,
            });
          }
        }
      }
      out[key] = [...(out[key] ?? []), ...flat];
      for (const group of childGroups) emit(group.key, group.placements);
    };
    for (const [key, placements] of Object.entries(layout.placeholders)) emit(key, placements);
    return { placeholders: out };
  };
};

/**
 * Flatten a single layout — the partial-design / page-design case,
 * where the recipe declares exactly one layout and the id counter's
 * scope IS that layout.
 */
export const flattenLayout = (layout: Layout): Layout => createLayoutFlattener([layout])(layout);
