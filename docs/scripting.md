# `scai/scripting` — ad-hoc TypeScript automation

A small ergonomic layer over the area-specific scai SDK entries
(`scai/hygiene`, `scai/deploy`, etc.) for the kind of one-off
TypeScript scripts that don't fit any CLI command: reverse-dependency
scans, surgical multilist edits, composite cleanup flows, custom
audit reporting.

If you're an _operator_ running a documented operation against a
tenant, use the CLI (`scai hygiene audit ...`, `scai hygiene cleanup ...`) or an MCP
client. If you're an _author_ writing a small TS script to do
something the CLI doesn't expose, this is for you.

## Stability

`scai/scripting` is an **unstable** SDK entry — it ships as the
`scripting` namespace of the `@sitecoreai-labs/sitecoreai-cli/unstable`
barrel and carries no SemVer stability promise. `scripting.connect()`
currently wires only the
`hygiene` area; its return shape will grow as more areas are wired, and
the helper pattern is still settling. The entry graduates to a stable
contract in a later release. Pin an exact scai version if you depend on
it today.

The composable helpers under `scai/scripting/helpers/*` are the
**extension point**. New helpers land here when a script pattern shows
up often enough that re-implementing it raw against `scai/hygiene`
becomes friction.

## Connect

```ts
import { scripting } from "@sitecoreai-labs/sitecoreai-cli/unstable";

const scai = scripting.connect({ envName: "sandbox" });
//          ^^^^^^^ uses defaultEnvProfile from sitecoreai.cli.json if omitted

// scai.hygiene is the same HygieneApiClient exported from scai/hygiene —
// `connect()` just wires env + auth so you don't repeat that block.
const fields = await scai.hygiene.getItemFields({ itemId: "..." });

// scai.authoring is the typed AuthoringApiClient — item reads plus
// createItem / updateItem / deleteItem / moveItem.
const item = await scai.authoring.getItem({ path: "/sitecore/content/Site" });
```

## Multilist GUID surgery

The Authoring API's `updateItem` mutation takes whole field values, so
removing one GUID from a pipe-delimited multilist by hand means parse
→ filter → rejoin → write. `cleanup find-replace` is regex-shaped and
trips on the surrounding pipes. This is the canonical script-shaped
case.

```ts
import { scripting } from "@sitecoreai-labs/sitecoreai-cli/unstable";

const scai = scripting.connect();

const result = await scripting.multilist.removeRef(scai, {
  itemId: "11111111-...",
  fieldName: "RelatedItems",
  refToRemove: "22222222-...", // case-insensitive, brace-tolerant
  // allowWrite defaults to false — dry-run by default
});

if (result.changed && !result.applied) {
  console.log("Would change:", result.before, "->", result.after);
}
```

`allowWrite: false` is the safe default. The helper returns
`{ changed, before, after, applied }` so a script can decide whether
to surface a diff to a human, write a report, or batch a confirmation
step before flipping the flag.

## Relocating items

Moving an item with the Authoring `moveItem` mutation preserves its
`itemId`, its name, and every inbound reference. Delete + recreate — the
only option before `moveItem` was wired up — assigns a fresh `itemId` and
breaks every link pointing at the old one.

`scai content move` is the CLI surface over the same mutation. Reach for
the helper when the CLI shape doesn't fit: moving many items in one pass,
computing the destination from a query, or composing a move with other
surgery in one script.

```ts
import { scripting } from "@sitecoreai-labs/sitecoreai-cli/unstable";

const scai = scripting.connect();

const result = await scripting.subtree.move(scai, {
  path: "/sitecore/content/MySite/OldHome", // or itemId
  toPath: "/sitecore/content/MySite/Archive", // or toItemId
  // allowWrite defaults to false — dry-run by default
});

if (result.changed && !result.applied) {
  console.log(`Would move ${result.from} -> under ${result.toParent.path}`);
}
```

Both ends resolve before anything is written, so a mistyped path fails
with a typed `INPUT_INVALID` naming the side that didn't resolve rather
than a generic GraphQL error. `changed: false` means the item already
sits under that parent — no wire call is made even with `allowWrite: true`.

## Safe-by-default

Every mutator in `scai/scripting/helpers/*` takes `allowWrite: boolean`
and defaults to `false`. This is the script-author equivalent of the
CLI's `--what-if` / `--allow-write` pair. The library layer still
enforces `ensureAllowWrite` per the env config — a script that flips
`allowWrite: true` against an env without `allowWrite` set will throw.

## What's not (yet) here

- `connect()` wires `hygiene` and `authoring`. Deploy / serialization /
  recipe area clients will join as scripts need them.
- `subtree` has only `move`. Bulk/recursive relocation (move a whole
  branch by query) is the obvious next helper.
- A reverse-dependency scan helper (parametric "find items referencing
  X under subtree Y") is the next obvious helper; landing once a few
  scripts have shaken out the right shape.
