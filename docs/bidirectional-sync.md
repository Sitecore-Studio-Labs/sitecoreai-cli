# Bidirectional sync — three-way merge between recipes, tenant, and baseline

`scai recipe push` writes recipes to a Sitecore tenant. `scai recipe pull`
reads tenant state back to disk. Before 0.3, these were one-way: push
overwrote any tenant-side author edit; pull was a snapshot dump that
ignored your local recipes. 0.3 lands a baseline-backed three-way merge
that lets push detect "the author edited this in the CMS since my last
push" instead of silently clobbering it, and lets pull detect "my local
recipe has changes the tenant hasn't seen" instead of overwriting them.

This doc is the operator walkthrough. The architectural rationale lives
in [`recipe-sync-architecture.md`](./recipe-sync-architecture.md).

## The baseline

After every successful `recipe push --allow-write`, scai writes a
per-(env, recipe) baseline file at:

```
<configDir>/.scai/baseline/<envName>/<slug(handle)>.baseline.json
```

The file is a SHA-256 hash per field the push wrote — small, not the
field values themselves. Hashes are enough to answer: "since my last
push, has the tenant value moved? has my recipe moved? both?"

The baseline is the third leg of the merge:

| What           | Where                                                       |
| -------------- | ----------------------------------------------------------- |
| Recipe (`R`)   | `./recipes/<name>.recipe.ts` (your source of truth on disk) |
| Tenant (`C`)   | Live state in Sitecore, read via `readCurrent`              |
| Baseline (`B`) | `.scai/baseline/<env>/<slug>.baseline.json` (last push)     |

Per-field classification:

```
R == B  &&  C == B   →  no-op (idempotent)
R != B  &&  C == B   →  recipe-change      (you edited the recipe — safe to push)
R == B  &&  C != B   →  cms-edit           (author edited tenant after last push)
R != B  &&  C != B   →  conflict           (both sides moved since baseline)
```

## Push side: `--conflict-policy` + `--no-baseline`

`recipe push` honours `--conflict-policy`:

- `error` (default) — block on any `cms-edit` or `conflict`. CLI exits
  non-zero, lists the per-(recipe, op) conflicts in the error details.
  Force the operator to look before clobbering.
- `recipe-wins` — clobber the author edit. Matches the pre-0.3 behaviour.
- `cms-wins` — preserve the author edit; drop the recipe-side change
  for this push.

Combined with `--allow-write` and `--allow-prune` (existing guards), push
now has three consent layers — apply, prune, conflict-policy — each
independent.

`--no-baseline` skips both the load and the post-apply write. Use it
for first-push runs against a clean tenant where the operator doesn't
want a baseline file, or in CI runs where the baseline isn't checked in.

### Worked example — push detects a CMS edit

```
$ scai provision recipe push -n staging --allow-write
[~] page-field:home@1:en:MetaTitle  — cms-edit: author edited tenant after last push;
                                       recipe would clobber. Pass
                                       --conflict-policy=recipe-wins or =cms-wins
                                       to resolve

Recipe push failed: 1 three-way merge conflict(s).
```

Resolution options:

```
# Author wins — preserve the CMS edit, drop my recipe change.
$ scai provision recipe push -n staging --allow-write --conflict-policy=cms-wins

# I win — clobber the CMS edit with my recipe value.
$ scai provision recipe push -n staging --allow-write --conflict-policy=recipe-wins
```

## Pull side: `--against` + per-recipe + per-field merge

`recipe pull --against ./recipes` enables merge mode. Pull:

1. Compiles the disk recipes through `compileRecipeSet`.
2. Reads tenant state via `readCurrentRecipes`.
3. Hashes per field on both sides via `collectBaselineEntries`.
4. Loads the baseline for each recipe.
5. Classifies per-(recipe, field) — six per-recipe statuses roll up
   from per-field classifications:

| Status          | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `in-sync`       | Disk + tenant agree (and match baseline if loaded)         |
| `disk-ahead`    | Disk has changes the tenant hasn't seen yet (push pending) |
| `tenant-edited` | Author edited tenant after last push                       |
| `conflict`      | Both sides moved since baseline — operator picks           |
| `disk-only`     | On disk, absent on tenant                                  |
| `tenant-only`   | On tenant, absent on disk                                  |

### `--conflict-policy=error|disk-wins|tenant-wins`

Direction-inverted from push's policy. Same `error` default that blocks
on operator-attention status. `disk-wins` keeps your local recipes
authoritative; `tenant-wins` adopts the author edits per-field.

- `error` (default) — exit non-zero on `tenant-edited` or `conflict`.
- `disk-wins` — keep your local recipes authoritative; write only
  `in-sync` / `tenant-only` / `tenant-edited` to outDir. Recipes with
  disk-side changes are skipped (your view stays canonical).
- `tenant-wins` — **per-field merge** for `ContentItem` and `Page`
  recipes: `disk-ahead` fields preserve disk's value, other statuses
  yield to tenant. Non-content kinds (templates, designs, placeholders)
  adopt the tenant projection wholesale.

Pull never overwrites authored `.recipe.ts` source — writes go to
`--output` (default `./pulled-recipes`). Operator manually reconciles
into source control.

### Worked example — pull catches both sides moving

```
$ scai provision recipe pull -n staging --against ./recipes
Pulled 12 recipes from staging (merge against ./recipes, policy=error)
  in-sync: 10
  tenant-edited: 1
  conflict: 1

  [!] hero@1            tenant-edited  (disk:0, tenant:1)
  [!] cta-button@1      conflict       (disk:2, tenant:1)

  ! blocked by --policy=error: 1 tenant-edited + 1 conflict
```

### `--write-plan` + `--apply-plan` for per-field operator picks

For granular reconciliation, dump a hand-editable plan:

```
$ scai provision recipe pull -n staging --against ./recipes --write-plan ./merge-plan.json
```

The plan file lists every per-field classification with a pre-filled
`winner` per the current policy. Operator opens, flips per-field
`winner` between `"disk"` and `"tenant"`, then applies:

```
$ scai provision recipe pull -n staging --against ./recipes --apply-plan ./merge-plan.json
```

Apply-plan verifies the plan still matches the current tenant + disk
state before committing — if a push happened between `--write-plan` and
`--apply-plan` (the world moved), pull refuses with a per-field drift
list and asks the operator to regenerate.

## Layout XML — canonicalised before hashing

Sitecore canonicalises layout XML server-side: push emits the canonical
form, the tenant returns SXA delta XML with `<p:da>` directives. The
two wire forms differ byte-for-byte for the same logical layout. To
keep baseline hashes stable across the push → re-read cycle, layout
fields are parsed through `parseLayoutXml` and serialised to a
deterministic JSON form before SHA-256.

This means layouts classify the same way as plain fields — including
per-(language, version) layout cells on multi-language pages.

## Field-shape decoders

`readCurrent` reconstructs `ContentFieldValue` from the wire string per
the field's declared shape on the template:

| Shape                        | Wire form                                | Decoded                                                                         |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `text` / `richText` / `enum` | raw string                               | passthrough                                                                     |
| `boolean`                    | `"1"` / `"0"`                            | `true` / `false`                                                                |
| `number` / `integer`         | numeric string                           | parsed                                                                          |
| `date` / `datetime`          | `yyyyMMddTHHmmssZ`                       | ISO 8601                                                                        |
| `image`                      | `<image mediapath="..." />` XML          | `{mediaPath, alt?, width?, height?}`                                            |
| `link` (external)            | `<link linktype="external" url="...">`   | `{shape: "link-external", href, text?, ...}`                                    |
| `link` (internal)            | `<link linktype="internal" id="{guid}">` | `{shape: "link-internal", ref, ...}` (only when GUID resolves via marker index) |
| `reference`                  | pipe-separated GUIDs                     | resolved to recipe handles via the marker index                                 |

Malformed wire values drop the field rather than fabricate — a
schema-violating value never round-trips.

## `BaselineStorage` interface — remote backends

`FileBaselineStorage` (default) writes to `<configDir>/.scai/baseline/`.
For CI flows / multi-operator setups where the baseline needs to be
shared, implement the `BaselineStorage` interface:

```typescript
interface BaselineStorage {
  load(envName: string, recipeHandle: string): Promise<Baseline | null>;
  write(envName: string, recipeHandle: string, baseline: Baseline): Promise<string>;
  locator(envName: string, recipeHandle: string): string;
}
```

Pass an instance via `RecipePushOptions.baselineStorage` or
`RecipePullOptions.baselineStorage` — no callsite changes needed. The
contract: `load` returns `null` for "no baseline yet" (first push);
throws only on integrity errors. `write` replaces the baseline
wholesale (no merge — caller provides the full field list captured
from the apply that just succeeded).

A remote orchestrator-hosted impl isn't shipped in 0.3 — interface
exists, endpoint design is the follow-up.

## Recovery — when the baseline file gets out of sync

The baseline is a hash-only optimisation. If it ever disagrees with
truth (manual `git checkout` of a stale state, copy-paste of recipes
from another env, baseline corruption), the safe reset is:

```
# Delete the baseline for one env (start fresh; next push recreates).
$ rm -rf <configDir>/.scai/baseline/<envName>/

# Or delete everything across envs.
$ rm -rf <configDir>/.scai/baseline/

# Then re-push to seed a fresh baseline.
$ scai provision recipe push -n staging --allow-write
```

Operators in a hurry can also pass `--no-baseline` to skip the load +
write for a single push, falling back to the pre-0.3 two-way (recipe-
wins) behaviour. Use sparingly — the baseline exists to prevent silent
clobbers, and `--no-baseline` re-enables that failure mode.

If `loadBaseline` throws `INPUT_INVALID` (JSON parse or schema
violation), scai refuses to use the corrupt file rather than silently
treating it as "no baseline" — the integrity error is surfaced with a
hint pointing at the file to delete. Don't `chmod` the file; rewrite
it via a fresh push.

## Performance notes

The merge path is mostly hash + map work, but for many-recipe pushes
the file I/O dominates:

- Baseline files load **in parallel** via `mapWithConcurrency` (pre-0.3
  patch did this sequentially).
- Layout XML is **parsed once per drift** (the planner used to parse
  4× per layout-field-drift; refactor in 0.3 dedups).
- Template per-field rollup **groups statuses once** instead of
  walking the map per field (O(T × S) → O(S + T)).

If you're seeing baseline-related slowness on a large push, profile
the actual disk reads — for >100 recipes you may want a remote
`BaselineStorage` impl that batches loads in one round trip.

## Lossy boundaries

Documented gaps from the audit pass:

- **Renames** (recipe handle / template name) detected as delete +
  create. The merge engine doesn't auto-reconcile the rename — operator
  picks per-field manually.
- **ComponentTemplate `variants[]` / `placeholders[]` / `placedIn[]`** merge
  wholesale under `tenant-wins` — separate merge semantics for these
  arrays aren't built yet. Fields and params do per-field merge.
- **`workflow` / `workflowState`** not reverse-projected (no workflow
  recipe → handle index). The recipe carries the handle on push; pull
  leaves it unset.
- **Per-property merge** (e.g., disk's `shape` + tenant's `source`
  within the same FieldDefinition) is intentionally NOT done — would
  risk a malformed FieldDefinition. Field is the unit of merge.

These are tracked as follow-ups in the merge memory entry; nothing
silently fails — the affected paths either preserve the safer side
or surface the limitation in the per-field classification.
