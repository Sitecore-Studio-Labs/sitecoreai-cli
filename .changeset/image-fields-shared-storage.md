---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Image-shaped template fields now default to SHARED storage (one value per item, applied to every language). Versioned image fields left every non-primary locale without the registry's role-based image defaults — Sitecore has no field-level language fallback by default, so localized pages rendered without imagery. Brand imagery is language-invariant, so shared is the right default; a recipe that wants per-locale imagery opts out with an explicit `sitecore.storage: "versioned"`. Re-pushing an existing component template updates the field definition in place.
