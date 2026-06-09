---
"@sitecoreai-labs/sitecoreai-cli": patch
---

campaign: re-stamp identity labels on an adopted project so pull can find it

A campaign project created before label-stamping (or whose first push failed to
stamp `story:`/`handle:` markers) was unfindable on pull (handle lookup) and
matchable only by a stamped id. When apply ADOPTS such a project (by id /
baseline) it now re-stamps the missing identity labels via a best-effort
`PUT /projects/{id}` (`updateProjectLabels`) — so the next pull resolves it by
handle. PUT on `/projects` is unverified on the tenant, so a failure is logged
and skipped, never fatal.
