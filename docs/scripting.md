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

`scai/scripting` is an **unstable** SDK entry — it ships under the
`@sitecoreai-labs/sitecoreai-cli/unstable/scripting` subpath and carries
no SemVer stability promise. `connect()` currently wires only the
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
import { connect } from "@sitecoreai-labs/sitecoreai-cli/unstable/scripting";

const scai = connect({ envName: "sandbox" });
//          ^^^^^^^ uses defaultEnvProfile from sitecoreai.cli.json if omitted

// scai.hygiene is the same HygieneApiClient exported from scai/hygiene —
// `connect()` just wires env + auth so you don't repeat that block.
const fields = await scai.hygiene.getItemFields({ itemId: "..." });
```

## Multilist GUID surgery

The Authoring API's `updateItem` mutation takes whole field values, so
removing one GUID from a pipe-delimited multilist by hand means parse
→ filter → rejoin → write. `cleanup find-replace` is regex-shaped and
trips on the surrounding pipes. This is the canonical script-shaped
case.

```ts
import { connect, multilist } from "@sitecoreai-labs/sitecoreai-cli/unstable/scripting";

const scai = connect();

const result = await multilist.removeRef(scai, {
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

## Safe-by-default

Every mutator in `scai/scripting/helpers/*` takes `allowWrite: boolean`
and defaults to `false`. This is the script-author equivalent of the
CLI's `--what-if` / `--allow-write` pair. The library layer still
enforces `ensureAllowWrite` per the env config — a script that flips
`allowWrite: true` against an env without `allowWrite` set will throw.

## What's not (yet) here

- `connect()` currently wires `hygiene` only. Deploy / serialization /
  recipe area clients will join as scripts need them.
- A `moveItem` helper is blocked on the underlying GraphQL mutation
  not yet existing in the SDK — see [`docs/roadmap.md`](./roadmap.md)
  § "Content-tree mutations".
- A reverse-dependency scan helper (parametric "find items referencing
  X under subtree Y") is the next obvious helper; landing once a few
  scripts have shaken out the right shape.
