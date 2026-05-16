---
"@sitecoreai-labs/sitecoreai-cli": major
---

**BREAKING: `--apply` is now required to execute mutations on every destructive scai CLI command.**

Pre-2026-05-14, scai mutated whenever the operator passed the
command-specific affirmative — `--allow-write` for cleanup, `--force`
for deploy delete. That made "I forgot `--what-if`" the same keystroke
as "delete." Agent-first inversion: scai never destroys without an
explicit affirmative on the command line.

**New rule:** without `--apply` (and absent an explicit `--what-if`),
destructive commands dry-run as if `--what-if` were set. A one-line
stderr hint surfaces the change so operators don't wonder why no
mutation happened:

```
$ scai cleanup dead-templates purge
Dry run (no --apply flag set). Pass --apply to execute the mutation.
... plan output ...
```

**Commands now gated** (CLI layer only — library callers and MCP tools
keep their existing per-call gating model):

- All `scai cleanup *` verbs: archive, dead-templates, duplicates,
  empty-folders, field-set, find-replace, language-versions, publish,
  rename, roles, site-residue, slug-conflicts, subtree, users,
  versions (prune + archive), workflow (advance + apply).
- `scai deploy environments delete`, `unlink-repository`, and
  `variables delete`.
- `scai deploy projects delete` and `unlink-repository`.
- `scai deploy editing-host delete`.

**Migration:**

- `scai cleanup X --allow-write` → `scai cleanup X --allow-write --apply`
- `scai deploy environments delete --force` → `scai deploy environments delete --force --apply`
- Existing `--what-if` scripts unchanged.
- The relationship between flags:
  - `--apply` is the universal "yes really execute" affirmative.
  - `--what-if` (any of: `-w`, `--what-if`) explicitly plans without executing — still works.
  - `--force` keeps its prior meaning: skip confirmation prompts.
  - `--allow-write` keeps its prior meaning: per-env safety belt for cleanup ops.
  - `--apply --what-if` together is invalid: `--what-if` wins (plan-only).
- The MCP write gate (`allowWrite: true` per call) is unchanged. MCP
  tools call task runners directly and bypass the CLI-layer `--apply`
  gate; their per-call write gate is already a strong affirmative.

Implementation: a new `withApplyGate(runner)` helper in
`src/commands/shared.ts` wraps each destructive command's `.action()`.
Without `--apply`/`--what-if`, it coerces `whatIf: true` before
invoking the runner. Six new unit tests in
`tests/unit/commands/apply-gate.test.ts` lock the behavior.
