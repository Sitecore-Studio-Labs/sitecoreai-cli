---
"@sitecoreai-labs/sitecoreai-cli": minor
---

SiteTemplate compile is now lossless — `compileSiteTemplateRecipe` writes
every field the schema accepts. Adds Module synthesis + picker SetField
ops (project paths, action templates, setup actions, picker UX fields),
a new MediaUpload IR op for thumbnails, and DictionaryRecipe with
`siteRole: shared` + cross-recipe shared-site validation. Live-verified
end-to-end against the sandbox tenant with integration coverage and
cleanup sweeps.
