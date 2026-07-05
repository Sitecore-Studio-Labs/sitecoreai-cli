---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Brandable image defaults: image fields can declare a semantic `role` (`hero`, `avatar`, `product`, …) — on `FieldDefinition` for SV defaults and on structured image values for content items/pages. A push/compile run can then supply `--image-defaults <file.json>` (or `SITECOREAI_IMAGE_DEFAULTS`), a flat role → external-URL map; any image whose role appears in the map materialises the mapped URL instead of the recipe-authored one, so a single brand-agnostic recipe yields brand-appropriate media per install. The refKey derives from the effective URL, so different brands' maps produce distinct media items on the same field. No map or unmatched role → recipe defaults apply unchanged; non-http(s) map values fail fast with `INPUT_INVALID`.
