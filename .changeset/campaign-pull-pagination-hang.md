---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(campaign): bound the campaign-pull project drain so large tenants don't hang

`findProjectByName` (the campaign recipe pull/adopt resolver) walked the
Orchestrate project list with an unbounded `for (;;)` loop whose only exit was
the API returning `next: null`. On a tenant with enough campaigns to paginate,
a `next` cursor that never nulled out (or repeated itself) made the pull page
forever — each request individually succeeding — until the orchestrator's
per-spawn timeout eventually killed it. Small tenants (single page) never hit
it, which is why it only surfaced on large campaigns.

The fix routes the drain through the same `drainPages` helper that already
guards the campaign-linked brief push (`findProjectIdByLabels`, shipped in
0.12.4): a hard page cap plus a non-advancing-cursor guard that degrades the
former infinite loop to a clean "not found" and logs a warning so the condition
is observable. `drainPages` + `MAX_LIST_PAGES` are lifted from the brief kind
into `@/shared/paginate` so both recipe kinds share one implementation.
