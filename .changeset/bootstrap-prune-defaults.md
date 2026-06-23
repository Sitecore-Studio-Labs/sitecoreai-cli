---
"@sitecoreai-labs/sitecoreai-cli": patch
---

feat(setup): `--prune-defaults` option on `setup bootstrap`

`scai setup bootstrap --prune-defaults` runs the SXA OOTB default-folder prune
(the same logic as `recipe prune-defaults`) as a final step after the recipe
push — removing the Media/Navigation/Promo/etc. clutter under Available
Renderings, Headless Variants, Data, and Presentation/Styles. Opt-in and
consent-gated (it's destructive); roots derive from the profile's
`site` + `siteCollection`.
