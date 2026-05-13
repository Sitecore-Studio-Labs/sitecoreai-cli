# Roadmap

Near-term improvements. Larger architectural shifts live in GitHub
issues/milestones, not here — this file is a quick-glance "what's in
flight" for new contributors.

## Near-term

- Config/schema enforcement for module configs loaded from packages.
- A `doctor` command to validate env/auth/config and surface actionable
  fixes.
- Configuration options for `sitecoreai.cli.json` storage location
  (currently fixed at the project root with `--config` as the override).
- **Two-environment `ser diff`** — add `--source-env` / `--target-env`
  to `scai serialization diff`. Implementation: pull source to a temp
  dir, run existing local-vs-remote diff against target, cleanup.
  Includes a `--push` variant that propagates the diff source → target
  (gated by target env `allowWrite`; supports `--what-if`). Matches
  dotnet's `sitecore ser diff --source --destination [--push]`.

## Feature areas

These are larger pieces of work scoped during the parity audit
(see [parity-with-devex.md](./parity-with-devex.md)). Each one is
sized for its own branch/PR.

### `scai content` — content hygiene command group

Replaces the XM-Cloud-shaped subset of dotnet `sitecore dbcleanup` with
operations expressible through the Authoring GraphQL API. SQL-level
operations (`clean-blobs`, `clean-fields`, `rebuild-descendants`) remain
out of scope — they aren't possible without direct DB access.

Initial scope:

- `scai content broken-links list` — internal links pointing to deleted
  items (uses the link database query).
- `scai content unused-media list` — media items with zero datasource
  / rendering-parameter references.
- `scai content orphans list` — items whose parents are gone.
- `scai content versions prune --keep N` — trim per-language version
  history.
- `scai content language-data clean` — language entries without versions
  (analogue of dotnet `clean-invalid-language-data`).
- `scai content stale-workflow list` — items stuck in workflow steps.

All `list` variants are read-only. Mutating verbs (`prune`, `clean`)
respect `--allow-write`, `--what-if`, and `--force`. Output piped as
item lists for chaining with `ser pull` / `ser push`.

### `scai publish item` — Edge publish trigger

Thin wrapper over the Authoring GraphQL publish mutation. Shape:

```sh
scai publish item --path <item-path> [--languages <l1,l2>] [--sub-items]
```

Replaces the XM-Cloud-relevant slice of dotnet `sitecore publish item`.
The rest of the dotnet Publishing plugin (`list-targets`, multi-target,
republish-all) is on-prem-only and stays out of scope.

### Resource package (`.dat`) builder — planned, unscoped

The dotnet `sitecore itemres` plugin builds protobuf-encoded `.dat`
files for on-prem Sitecore's resource-item loader. Real demand exists
from teams shipping content to on-prem installs. Implementation
requires protobuf-net schema work that isn't trivially available in
the JS ecosystem.

No design has been committed. The most likely shapes are (a) reuse
the dotnet protobuf-net schema via a JS protobuf library if the schema
can be reconstructed, or (b) shell out to a small dotnet helper. Both
have material trade-offs (schema fidelity vs. install footprint). To
be scoped when there's concrete user demand.

## CI and release

- CI preflight checks for publish credentials, org access, and release
  gating.
- Re-enable npm provenance when the repo goes public (see
  [`release.md`](./release.md)).

## Telemetry UX

- Persisted defaults and clearer status output for telemetry opt-in/out.
