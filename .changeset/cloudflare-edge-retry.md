---
"@sitecoreai-labs/sitecoreai-cli": patch
---

GraphQL transport: detect Cloudflare edge error pages and retry them instead of surfacing an opaque HTML dump under a misleading status

When a Sitecore Authoring/Management request dies at the Cloudflare edge (e.g. a cold-scaled or newly-provisioned CM host briefly unroutable), Cloudflare returns an HTML error page — often under a status unrelated to the API (a `1018 "could not find host"` page can arrive as a `409`). The transport previously echoed that raw status with the whole HTML page as the message and never retried it, so a momentary edge blip mid-operation failed hard (e.g. `Sitecore Authoring API request failed (409)` with a Cloudflare page body).

The transport now recognizes a Cloudflare edge page (only ever a non-JSON body — a genuine JSON API error is untouched) and classifies it: **"never reached origin"** failures (`1016/1018/521/523`) are safe to retry even for writes (the request did not apply), while **ambiguous** edge timeouts (`524/520`) are gated like other ambiguous-network failures so mutation callers don't risk a duplicate. Edge failures now surface a concise message ("host temporarily unreachable at the Cloudflare edge (…)") with a cold-start hint instead of the raw page.
