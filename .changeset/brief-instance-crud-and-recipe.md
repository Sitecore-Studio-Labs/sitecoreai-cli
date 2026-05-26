---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Add brief-instance CRUD and recipe sync (unstable surface)

The `scai ops brief` surface previously exposed declarative recipe sync
only for brief _types_ (the schema templates); brief instances had
runtime-only `delete` / `set-status`. This adds the missing CRUD verbs
and a parallel recipe kind so populated briefs can be authored, diffed,
and pushed declaratively alongside their types.

**CLI**

- `scai ops brief create -f <file>` — POST a brief from a
  `CreateBriefInput` JSON document. Dry-runs by default; `--apply` to
  write.
- `scai ops brief update <briefId> [-f <file>] [--status <s>]` —
  partial-PUT update of a brief. Pass `-f` for arbitrary patches or
  `--status` as a shortcut for a status-only move.
- `scai ops brief sync {pull,diff,push} [--kind brief|brief-type]` —
  the recipe verbs now take a `--kind` discriminator. Defaults to
  `brief-type` for back-compat with existing scripts; `--kind brief`
  operates on brief instances (identified by display `name`,
  referencing their type by codename via `briefTypeName`).

**SDK**

- `assertCreateBriefInput` — validates the brief create body shape;
  mirrors `assertCreateBriefTypeInput`.
- `briefInstanceKind` + `BriefInstanceRecipeSchema` — the new recipe
  kind; registered with the cross-domain aggregate sync so
  `scai sync` / the `recipe_sync` MCP tool fan out over brief
  instances automatically.

**MCP**

- `brief_manage` extended: `resource='brief'` now supports `create`
  (requires `briefTypeId` and a `brief` body) and `update` (partial
  PUT, any subset of name/locale/fields/isTemplate plus an optional
  `status`).
- `brief_recipe_inspect` / `brief_recipe_push` extended with a
  `kind: 'brief-type' | 'brief'` discriminator (default `brief-type`).

**Behavior to know**

- Briefs are matched by display `name` on diff/push (first-match-wins,
  mirroring the campaign-instance precedent — the Brief list endpoint
  has no server-side name filter).
- `createBrief` accepts no `status` field; the kind follows up with a
  PUT when the recipe pins a non-`Draft` status so the post-apply
  state matches the recipe.
- Repointing an existing brief at a different brief type is refused
  with a typed error (`INPUT_INVALID`) — the Brief API has no
  verified path for that.
- Surface remains `[unstable]` — schemas and behavior may change in
  any release.
