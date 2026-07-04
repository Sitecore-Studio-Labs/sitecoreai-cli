---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `mediaLibraryRoot` derivation from `site` + `siteCollection`. `withDerivedRecipeRoots` never mapped the derived `mediaLibrary` root onto the flat `mediaLibraryRoot`, so every derivation-based profile (including all hosted installs) compiled media uploads against the `/sitecore/media library/RecipeImages/<site>` fallback instead of `/sitecore/media library/Project/<collection>/<site>`. Media items created outside the SXA site's media scope resolve in the Layout Service but Pages' image-field picker can't display them — the field shows a raw GUID instead of an image path. Uploads (including `mediaLocation` page/site-scoped destinations) now land under the site's Project media folder; re-pushing rewrites affected fields to newly-placed items.
