---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Partial-design and page-design layouts now encode variants + rendering parameters in the same wire form pages do. The page compiler resolves a placement's variant to its headless Variant Definition item GUID (so XM Cloud Pages' variant picker displays it) and maps each param to its Sitecore field's stored value (enum Droplinks → enum-value GUIDs, checkboxes → `1`/`""`) — but the partial/page-design compilers never got those encoders, so a design's renderings landed with raw variant names and raw param values and didn't resolve correctly. The `variantRefFor` + `paramValueFor` encoders are extracted into a shared `layoutEncodingOptions` used by all three layout-holding compilers, so pages, partial designs, and page designs encode identically.
