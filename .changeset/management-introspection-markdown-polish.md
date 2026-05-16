---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Markdown polish for `audit all` + Management API security findings
documented.**

**Markdown output adapter** — `audit all` envelopes now render as
human-readable reports:

- Header block (`# Audit report — <env>`).
- Summary callout (`> **Summary**`) with audits-run, total findings,
  baseline-ignored counts, and failed-audit count.
- Breakdown table — per-audit row with findings count, ignored
  count, duration, and any error. Sorted by findings desc.
- Per-audit `##` sections for audits with findings (or errors).
  Audits with zero findings collapse to just their breakdown row.
- Failed audits get an `⚠️` callout with the error message.

Single-audit envelopes (e.g. `audit broken-links list --format md`)
retain their existing shape: heading + metadata bullets + table
(flat rows) or fenced JSON (nested rows).

**Management API introspection** — documented in `parity-with-devex.md`.
The summary:

- `Authoring.Item.access` exposes booleans from the **caller's**
  perspective only; no per-role ACL detail.
- `Management.users(predicates)` + `Management.roles(predicates)`
  exist but `Predicate.pattern` is substring match (not glob/SQL
  LIKE), and the resolver is unreliable under repeated OAuth
  client-credentials calls.
- Per-role ACL audits (`anonymous-write`, `excessive-acls`,
  `unapproved-users`) aren't reliably buildable from XM Cloud APIs.
  Stay out of scope until the API surface improves.

1 new unit test covering the audit-all Markdown shape (199 hygiene
tests total). Live-validated against the sandbox tenant — `audit all
--output report.md` produces a clean per-audit summary.
