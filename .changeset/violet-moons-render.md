---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Materialise external-URL image fields as real media items. Image field values and standard-values image defaults with fully-qualified URLs now compile to a `MediaUpload` op (the executor downloads the bytes and uploads them to `/sitecore/media library/RecipeImages/…`) plus a `media-xml-ref` value resolving to `<image mediaid="{GUID}" />`. The previous `src=` XML form stored the URL but the Layout Service never surfaced it as a renderable `src` — images showed a thumbnail in Pages' field editor but rendered nothing on the canvas or in head apps. Repeated (field, URL) pairs across languages/versions dedupe to a single upload.
