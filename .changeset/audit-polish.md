---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Audit suite + trend history — final polish on the hygiene surface.**
Two new top-level capabilities for codifying hygiene policy + tracking
how findings change over time.

**`scai audit suite run --file <file.yaml>`** — execute a YAML-defined
audit pipeline. Operators commit a suite file to version control,
defining which audits to run with which options. Suite shape:

```yaml
version: 1
name: monthly-hygiene
audits:
  - name: broken-links
    options: { root: /sitecore/content/MySite, limit: 1000 }
  - name: duplicates
    options: { min-group-size: 3 }
output:
  format: markdown
  path: ./reports/{date}.md
baseline:
  enabled: true
```

Output-path tokens: `{date}`, `{datetime}`, `{env}`, `{suite}`.
`--only audit-a,audit-b` runs a subset of the suite. Kebab-case
option keys are converted to camelCase for the underlying audit
options.

**`scai audit history <capture|list|diff>`** — snapshot `audit all`
results and compute deltas. Distinct from baselines (an ignore-list)
— history is a journal.

- `capture` — runs `audit all`, persists per-audit finding
  fingerprints + sample identifying fields to
  `.scai/audit-history/<env>/<datetime>.json`. Compact storage (no
  full payload).
- `list` — show snapshots, newest first.
- `diff [--from X --to Y]` — compare two snapshots; reports per-audit
  totals (from → to), added items, removed items. Defaults to the
  two most recent snapshots. Identity by fingerprint, same rules as
  baselines (transient fields like `daysSinceUpdate` excluded).

**Behind the scenes:**

- `src/hygiene/audit-suite.ts` — YAML loader + path-template
  expansion + suite-to-runner-input adapter.
- `src/hygiene/history.ts` — `captureHistory`, `listHistory`,
  `loadSnapshot`, `diffSnapshots`. Per-env directories.

13 new unit tests (199 total in hygiene module). Live-validated
suite-run + capture/list flow against the sandbox tenant.
