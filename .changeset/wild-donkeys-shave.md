---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Surface the underlying cause of a failed Sitecore GraphQL request.

Node's `fetch` rejects with a bare `TypeError: fetch failed` — two words that
are identical for a DNS miss, a refused connection, an expired certificate,
and a broken proxy. The reason lives on `.cause`, which the Authoring/Edge
transport was dropping, so `scai` reported only "Sitecore Authoring API
request failed: fetch failed".

The error now names the cause and its code, e.g.
`… fetch failed (cause: ENOTFOUND: getaddrinfo ENOTFOUND cm.example.com)`.
`AggregateError.errors` is walked too, so happy-eyeballs dual-stack failures
list both address families. Output is still passed through `redactSecrets`.
