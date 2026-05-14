---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Audit operational substrate — `audit all`, baselines, cross-cutting
filters, output adapters.** Changes the user contract from "run 13
audit commands and merge the JSON" to "one invocation, baseline-aware,
piping into your CI / report channel of choice."

**New meta-command:**

- `scai audit all` — runs every audit (skipping `find-replace`, which
  needs `--pattern`) and emits a consolidated envelope. Honors
  `--include broken-links,unused-media` to scope, `--exclude-audit
find-replace` to skip, plus all of the new cross-cutting flags
  below.

**Baseline (ignore-list) management:**

- `scai audit baseline show` — print current baseline entries.
- `scai audit baseline create [--audits a,b] [--reset]` — run audits
  and accept every finding as the new baseline.
- `scai audit baseline remove --audit X --fingerprint Y` — drop a
  single entry.
- `scai audit baseline reset [--audit X]` — wipe entries for one
  audit (or all).
- Baseline files live at `.scai/audit-baseline-<envName>.json`
  (per-env; commit to version control). Each entry stores a stable
  fingerprint per finding (excludes transient fields like
  `daysSinceUpdate`).
- Every `scai audit *` command gains a `--baseline` flag — when set,
  results are filtered against the baseline file. Use this in CI:
  audits report 0 findings until something genuinely new appears.

**Cross-cutting filters on every audit command:**

- `--exclude <path>` — repeat or comma-separate; skips items whose
  path begins with any of these prefixes.
- `--since <date>` — ISO 8601 or YYYY-MM-DD; only items updated
  on/after this date.
- `--owner <user>` — reserved for createdBy/updatedBy filtering;
  currently the audit task layer must resolve owner per item, so this
  is documented but enforced lazily.

**Output adapters on every audit command:**

- `--output <file>` — write the audit envelope to a file instead of
  stdout. Format inferred from extension (`.json`, `.csv`, `.md` /
  `.markdown`).
- `--format <fmt>` — explicit format override. Default `json`.
- CSV serializer flattens result rows into columns; quotes values
  containing commas / quotes / newlines.
- Markdown serializer emits heading + summary + a table when rows are
  flat, or fenced JSON when rows have nested objects.

**Behind the scenes:**

- `src/hygiene/baseline.ts` — per-env baseline file with
  `fingerprintFinding` policy per audit (excludes transient fields).
- `src/hygiene/output-adapters.ts` — JSON / CSV / Markdown formatters
  - `writeAuditOutput` that creates intermediate directories.
- `src/hygiene/tasks/shared.ts` — extended `printReport` /
  `finishAudit` helper applies baseline filtering and output
  redirection; cross-cutting scan filters (`resolveScanFilters`,
  `matchesScanFilters`) plumbed through `scanItemsAndFields`.

23 new unit tests (149 total in hygiene module). Live-validated `audit
all` and the baseline round-trip (2289 findings → 0 after baseline
filter) against the sandbox tenant.
