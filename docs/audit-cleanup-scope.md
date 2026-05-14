# `scai audit` and `scai cleanup` — scope & known gotchas

This doc captures cross-cutting facts about the hygiene surface that
apply to every audit and cleanup verb — read once, save re-asking the
same questions per-command.

## Database scope: master only

XM Cloud's Authoring API operates against the **master** database. There
is no `web` database on XM Cloud — the published edge is served by
**Experience Edge**, which is a separate query surface (the Edge
Delivery / Edge Preview GraphQL endpoints) and is not in scope for
these audits.

Practical consequences:

- "Stale", "orphaned", "dead", "duplicate", and "broken" findings
  reflect master-side state only. An item the audit flags as "orphaned"
  may still be served by Edge (if it was published before being
  unlinked), and vice versa.
- After `scai cleanup` mutates master, the published edge does **not**
  update until a publish runs. Use `scai publish` (or the Sites API
  publish flow) to propagate cleanup results to Edge.
- Audits never claim findings are present on the live site. Cross-check
  via Edge if production traffic is at stake.

If you're coming from on-prem Sitecore: the historical "publish from
master to web" model doesn't exist on XM Cloud. The closest analog is
"publish from master to Edge", but Edge is queried by URL/path rather
than walked like a database.

## Known gotcha: post-cascade-delete cache staleness

The Authoring API maintains a server-side template-dependency cache
that lags actual writes. After a large cascade delete — for example,
`cleanup subtree delete` over a tree containing items derived from a
shared template — running `cleanup dead-templates purge` against that
template **may still fail** with a "template has dependents" error for
~30–90 seconds, even though every dependent has just been deleted.

**Workaround.** Either:

1. **Wait and retry.** Most caches settle within a minute or two.
   `scai cleanup dead-templates purge --what-if` is a cheap way to
   re-check.
2. **Run the cascade in two passes.** Delete dependents first
   (`cleanup subtree delete --path <tree>`), wait for the cache to
   settle, then delete templates (`cleanup dead-templates purge --root
   /sitecore/templates/<area>`).

Re-run on success doesn't risk over-deletion because cleanup verbs are
idempotent on missing targets — a template that's already gone is
treated as a no-op, not an error.

If you see this fail in a script that absolutely cannot retry: file a
new issue with the cleanup command, the dependent path you deleted, and
the template id that refused to delete. The retry guidance above is a
known-limitation workaround, not a fix.
