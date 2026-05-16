---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`audit baseline` polish: surface counts in every audit summary + new `accept --from-stdin` pipeline verb.**

The feedback agent's diagnosis (refined from the original "persistent
session state" framing): baseline isn't a missing feature, it's an
underused one. Two reasons it stayed invisible:

1. Audit summaries didn't mention the baseline unless the operator
   passed `--baseline` — so nobody knew it was there.
2. Adding a finding to the baseline meant copying its fingerprint
   out of `baseline show` and feeding it to a follow-up command, or
   running `baseline create` (which accepts _everything_ current,
   typically too broad).

This release closes both gaps.

### Auto-surfaced baseline counts in audit output

`finishAudit` (the shared printer behind every `audit X list`) now
always opens the per-env baseline and surfaces the count of already-
accepted findings for the audit being run — even when `--baseline`
isn't set. The non-JSON output adds one gray line under the headline:

```
30 broken-links findings.
  (5 findings in baseline; pass --baseline to filter, or
   'scai audit baseline accept --audit broken-links --from-stdin' to add more)
```

The JSON envelope gets a `meta.baselineAcceptedTotal` field so agents
can branch on it. When `--baseline` is on, the existing
`ignoredCount` line wins — they're complementary, not redundant.

Cost: one extra `fs.existsSync` + JSON parse per audit run, ~ms on
warm disk.

### New verb: `scai audit baseline accept`

```bash
$ scai audit broken-links list --json \
  | scai audit baseline accept --audit broken-links --note "known debt"

Accepted 30 new findings into baseline .scai/audit-baseline-sandbox.json.
```

Reads a `ScaiEnvelope` from stdin (composes with the
audit→cleanup pipelining released in the prior changeset) and adds
every finding in `envelope.data` to the baseline. Idempotent —
running it twice doesn't double-count. Optional `--note <text>`
records why a batch was accepted (recorded per-entry so future
`baseline show` callers can see context).

Implementation: new `runBaselineAccept` task runner in
`src/hygiene/tasks/audit-baseline.ts`; CLI wiring in
`src/commands/audit/baseline.ts`. 6 unit tests in
`tests/unit/hygiene/tasks/audit-baseline-accept.test.ts` lock the
input validation + idempotency + note recording.
