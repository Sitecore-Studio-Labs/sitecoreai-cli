---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Image-defaults substitution no longer overrides authored content values. The role→URL map substitutes ONLY into template Standard Values (the component's stock defaults); page and content-item image values — authored content — always win, matching Sitecore's page-value-over-standard-value semantics.
