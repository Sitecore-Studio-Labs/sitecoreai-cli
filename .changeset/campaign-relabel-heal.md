---
"@sitecoreai-labs/sitecoreai-cli": patch
---

campaign: re-stamp identity labels on an adopted project so pull can find it

A campaign project created before label-stamping (or whose first push failed to
stamp `story:`/`handle:` markers) was unfindable on pull (handle lookup) and
matchable only by a stamped id. When apply ADOPTS such a project it now
re-stamps the missing identity labels as part of the full-object
`PUT /projects/{id}` (verified supported) — so the next pull resolves it by
handle. Rides the same update path as project field convergence.
