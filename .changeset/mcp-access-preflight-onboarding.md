---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**MCP access preflight, environment onboarding, and traversal-based
content browsing — plus a structured error-remediation contract.**

**New MCP tools.**

- `access_check` — a one-call config / policy / credential preflight.
  Each gate reports pass/fail with a structured remediation, so an MCP
  client can diagnose a misconfigured environment without a trial-and-
  error sequence of tool calls.
- `content_browse` — bounded-depth, traversal-based content-tree
  listing. Unlike a search-backed listing it needs no provisioned search
  index, so it works on a freshly created environment.
- `environment_onboard` — write-gated onboarding of a new environment
  profile.

**Error-remediation contract.** `ScaiError` now carries a `remediation`
with an `actor` classification (`agent`, `needs-human-terminal`,
`transient-retry`), surfaced consistently in CLI JSON output, CLI text
output, and the MCP error envelope, and wired into the policy and
credential error sites. Human-only operations are declared as capability
metadata and advertised by `scai_overview`, so an agent knows up front
which steps it cannot complete unattended.

**Fixes.**

- `listItemTemplates --root` resolves the root by exact path match and
  post-filters by path prefix; an unresolved root now throws instead of
  silently returning an empty list.
- The `dead-templates` audit gives a clear remediation when the
  environment has no search index, pointing at the traversal-based
  audits instead.
- `setup env` polls a freshly minted client until it activates, rather
  than reporting success while the client still returns `AUTH_REQUIRED`.
