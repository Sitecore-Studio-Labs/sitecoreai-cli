---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Audit → cleanup pipelining: `scai cleanup duplicates purge --from-stdin` skips the internal audit re-run.**

The feedback agent flagged that `scai audit duplicates list` and
`scai cleanup duplicates purge` run the same content-hash scan twice
in series (the cleanup invokes `runAuditDuplicates` internally), and
that the two CLI invocations can disagree on the group set when the
tenant changes between calls. Same pattern applied to other cleanups
that wrap their matching audit.

The fix: cleanup tasks now accept a `preComputedGroups` (and similar
pre-computed inputs in follow-ups) option that bypasses the internal
audit and uses the supplied findings directly. At the CLI layer,
`--from-stdin` reads a `ScaiEnvelope` from stdin and pipes its `data`
into `preComputedGroups`:

```bash
$ scai audit duplicates list --json > dupes.json
$ scai cleanup duplicates purge --from-stdin --apply < dupes.json

# or in one shell pipeline:
$ scai audit duplicates list --json \
  | scai cleanup duplicates purge --from-stdin --apply
```

This lets operators:

- Inspect or filter the audit envelope between the two steps (e.g.
  drop groups they want to keep).
- Run audit on a snapshot, archive it, and cleanup later against the
  exact same group set.
- Compose audit + cleanup in CI without re-running the slow scan.

Implementation:

- New `readScaiEnvelopeFromStdin<T>()` helper in
  `src/shared/envelope.ts`. Validates required envelope keys
  (`command`, `data`) and surfaces clear errors for empty / non-JSON /
  non-object input. 7 unit tests pin the parsing contract.
- `runCleanupDuplicates` accepts an optional `preComputedGroups:
DuplicatesGroup[]`. When set, the internal `runAuditDuplicates`
  call is skipped entirely. 1 unit test confirms the audit is not
  re-invoked under that path.
- The CLI `cleanup duplicates purge --from-stdin` wraps the runner
  call with a stdin reader; pairs with `--apply` to actually delete.

Follow-up: extend the same pattern to `cleanup subtree`
(`preComputedSubtreeRoots`), `cleanup site-residue`
(`preComputedFindings`), and `cleanup slug-conflicts`
(`preComputedConflictGroups`) so the full audit↔cleanup surface
supports composition. The shared reader helper is generic — each
cleanup just needs to wire the appropriate `data` shape into its
options.
