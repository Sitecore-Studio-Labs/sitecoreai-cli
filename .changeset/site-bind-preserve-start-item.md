---
"@sitecoreai-labs/sitecoreai-cli": patch
---

deploy site bind: preserve an existing site's Start Item instead of requiring `<siteRoot>/Home`

`createSiteBinding` reconstructed the start item as `<siteRoot>/<startItemName>` (default `Home`) and hard-failed with `INPUT_INVALID: Start item '…/Home' was not found` when that exact item didn't exist — even for a perfectly valid existing site whose home is named or located differently. Binding an existing site to a new editing host only needs to (re)point `RenderingHost`/`HostName`; the site already has a Start Item. Now, when the Site Grouping already carries a `StartItem`, it is preserved verbatim and no `<siteRoot>/Home` lookup is required. The conventional `<siteRoot>/<startItemName>` fallback (and its error) only applies when the Site Grouping has no Start Item yet.
