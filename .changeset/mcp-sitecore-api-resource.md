---
"@sitecoreai-labs/sitecoreai-cli": patch
---

**MCP — adds two Sitecore API docs resources.** Brings the MCP server's
resource count from 5 to 7:

- `scai://help/sitecore-apis` — curated markdown index of the Sitecore
  REST + GraphQL APIs scai's library wraps (XM Cloud Deploy API,
  Authoring & Management GraphQL, Sites API, SAI Publishing API), with
  deep links into api-docs.sitecore.com and per-API tool mappings.
- `https://api-docs.sitecore.com/` — companion external URI for clients
  that resolve `https://` resource URIs natively. The handler returns
  a one-line pointer; the actual fetch happens client-side.

Both surfaced via `scai_overview`'s `resourceUris` snapshot and the
overview resource's listing.
