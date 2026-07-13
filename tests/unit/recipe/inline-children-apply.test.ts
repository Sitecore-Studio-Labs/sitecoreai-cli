/**
 * Inline treelist children — APPLY-time identity.
 *
 * `inline-children.test.ts` covers the COMPILER: it proves the IR carries one
 * `CreateItem` per array entry, each with its own derived refKey. That is not
 * enough. The children are created under a SHARED parent, and every item one
 * recipe creates carries the SAME `Scai Handle` marker (the marker is
 * recipe-scoped, by design — it is what lets a renamed item still be found).
 *
 * The planner's sibling fallback used to read:
 *
 *     const marked = siblings.filter((s) => remoteHandleMarker(s) === handle);
 *     return marked.length === 1 ? marked[0] : null;   // "one ⇒ renamed"
 *
 * which collapses inline children on the very first push:
 *
 *   - `Cards-1` creates.
 *   - `Cards-2` misses on path AND name, sees exactly ONE marked sibling
 *     (`Cards-1`, created moments ago in this same push), calls it a rename,
 *     and rebinds onto it — UPDATING `Cards-1` instead of creating `Cards-2`.
 *   - The collapse holds the marked count at one, so every later child does
 *     the same.
 *
 * Net effect: N children become 1 item, each overwriting the last — a 7-entry
 * nav shipped its LAST entry seven times. These tests pin the identity end to
 * end (compile → plan → apply against a tenant), which is the only level the
 * bug is visible at.
 */
import { describe, expect, it } from "vitest";
import type { RemoteItem } from "../../../src/recipe/api/client";
import { type CompileContext, compileRecipeSet } from "../../../src/recipe/compile";
import { injectHandleMarker } from "../../../src/recipe/items/marker";
import type { OperationIr } from "../../../src/recipe/ir/operations";
import { executeIr } from "../../../src/recipe/runtime/execute";
import type { Recipe } from "../../../src/recipe/schema/recipe";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  pageTemplatesRoot: "/sitecore/templates/Project/Demo",
  pagesRoot: "/sitecore/content/Demo/Home",
  partialDesignsRoot: "/sitecore/content/Demo/Presentation/Partial Designs",
};

const landingPageTemplate = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "landing-page@1",
  name: "LandingPage",
  displayName: "Landing Page",
  fields: [],
} as unknown as Recipe;

const cardGridComponent = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "card-grid@1",
  name: "CardGrid",
  displayName: "Card Grid",
  fields: [
    { name: "Heading", shape: "text" },
    {
      name: "Cards",
      shape: "reference",
      multiple: true,
      sitecore: { source: { kind: "filter", types: ["card@1"] } },
    },
  ],
} as unknown as Recipe;

const cardContentTemplate = {
  kind: "content-template",
  schemaVersion: "1",
  handle: "card@1",
  name: "Card",
  displayName: "Card",
  fields: [{ name: "Title", shape: "text" }],
} as unknown as Recipe;

/** The SYNC nav that surfaced this: seven flat entries in one treelist. */
const TITLES = ["Speakers", "Headphones", "Amps", "Pro", "Artist Services", "Support", "Search"];

const pageWithCards = (titles: readonly string[]): Recipe =>
  ({
    kind: "page",
    schemaVersion: "1",
    handle: "home@1",
    name: "Landing",
    displayName: "Landing",
    template: "landing-page@1",
    layout: {
      placeholders: {
        "headless-main": [
          {
            componentHandle: "card-grid@1",
            datasourceRef: {
              kind: "scoped",
              slot: "Grid",
              fields: {
                Heading: "Categories",
                Cards: titles.map((Title) => ({ Title })),
              },
            },
          },
        ],
      },
    },
  }) as unknown as Recipe;

/**
 * Compile the page AND stamp the `Scai Handle` marker, exactly as the push
 * pipeline does (`recipe-kind.ts` runs `injectHandleMarker` before apply).
 *
 * The marker is load-bearing here, not incidental: it is what the planner's
 * sibling fallback matches on, so an IR without it never exercises the
 * rebind path at all. Compiling straight from `compileRecipeSet` would make
 * these tests pass against the very bug they exist to pin.
 */
const compilePage = (titles: readonly string[]): OperationIr => {
  const irs = compileRecipeSet(
    [landingPageTemplate, cardGridComponent, cardContentTemplate, pageWithCards(titles)],
    CONTEXT
  );
  const pageIr = irs.find((ir) => ir.recipeHandle === "home@1");
  if (!pageIr) throw new Error("page IR missing from set");
  return injectHandleMarker(pageIr);
};

const allItems = (client: MockAuthoringClient) => [...client.itemsById.values()];

/** Every item the tenant holds whose name looks like an inline child. */
const childItems = (client: MockAuthoringClient) =>
  allItems(client).filter((item) => /^Cards-\d+$/.test(item.name));

const titleOf = (item: RemoteItem): string | undefined =>
  item.fields.find((f) => f.name === "Title")?.value;

/** Rename an item the way a CMS author would — the name AND the path move. */
const renameItem = (client: MockAuthoringClient, itemId: string, newName: string): void => {
  const item = client.itemsById.get(itemId.toLowerCase());
  if (!item) throw new Error(`no such item: ${itemId}`);
  const parentPath = item.path.slice(0, item.path.lastIndexOf("/"));
  const renamed: RemoteItem = { ...item, name: newName, path: `${parentPath}/${newName}` };
  client.itemsByPath.delete(item.path.toLowerCase());
  client.itemsByPath.set(renamed.path.toLowerCase(), renamed);
  client.itemsById.set(itemId.toLowerCase(), renamed);
};

describe("inline treelist children — apply-time identity", () => {
  it("creates ONE Sitecore item per array entry, not one item overwritten N times", async () => {
    const client = new MockAuthoringClient();
    const result = await executeIr(compilePage(TITLES), client, { mode: "apply" });
    expect(result.aborted).toBe(false);

    const children = childItems(client);

    // The regression: all seven collapsed onto a single item, so this was 1.
    expect(children).toHaveLength(TITLES.length);
    expect(new Set(children.map((c) => c.itemId.toLowerCase())).size).toBe(TITLES.length);

    // ...and each holds its OWN title, rather than every entry having been
    // overwritten by the last one ("Search" seven times).
    expect(children.map(titleOf).sort()).toEqual([...TITLES].sort());
  });

  it("is idempotent — a re-push rebinds to the same items instead of duplicating", async () => {
    const client = new MockAuthoringClient();
    const ir = compilePage(TITLES);

    await executeIr(ir, client, { mode: "apply" });
    const firstIds = childItems(client)
      .map((c) => c.itemId.toLowerCase())
      .sort();

    await executeIr(ir, client, { mode: "apply" });
    const secondIds = childItems(client)
      .map((c) => c.itemId.toLowerCase())
      .sort();

    // Same items, no duplicate siblings — the name/path match still binds.
    expect(secondIds).toEqual(firstIds);
    expect(childItems(client)).toHaveLength(TITLES.length);
  });

  it("still rebinds a RENAMED child rather than duplicating it", async () => {
    // The marker fallback exists for exactly this case, and the fix must not
    // break it: a CMS user renames a child, so neither path nor name matches.
    // The renamed item's name is precisely the one no CreateItem op claims,
    // so it remains the unambiguous rebind candidate.
    const client = new MockAuthoringClient();
    const ir = compilePage(["Solo"]);
    await executeIr(ir, client, { mode: "apply" });

    const [child] = childItems(client);
    expect(child).toBeDefined();
    renameItem(client, child.itemId, "Renamed By An Author");

    await executeIr(ir, client, { mode: "apply" });

    // Rebound onto the renamed item — NOT duplicated back to `Cards-1`.
    const cards = allItems(client).filter(
      (i) => titleOf(i) === "Solo" || /^Cards-\d+$/.test(i.name)
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].itemId.toLowerCase()).toBe(child.itemId.toLowerCase());
  });
});
