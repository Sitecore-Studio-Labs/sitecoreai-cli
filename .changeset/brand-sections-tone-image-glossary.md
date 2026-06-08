---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Repair three brand-kit sections that were broken in the Sitecore AI app.

**Tone of Voice / Image Style** (`richArray` scenarios): scai wrote scenario entries as bare `{name}`, dropping empty `tags`/`restrictions`. The Sitecore AI section page renders each entry with an unguarded `entry.tags.map(...)`, so a missing `tags` threw `Cannot read properties of undefined (reading 'map')` and the whole page failed to load. `toObjectArrayValue` now always emits `tags: []` and `restrictions: ""` for `richArray` entries.

**Glossary terms**: each term is a _field_ the enrichment pipeline never creates, so the section stayed empty and term changes were skipped (no field id to PATCH). The Brand Management API exposes `POST .../sections/{id}/fields` (`create_brand_kit_section_field`) — it was just never wrapped. Adds `createBrandKitSectionField` and, in `apply`, creates the field for a glossary-shaped change (name = term, type = `array`, value = locale rows) instead of skipping. Also fixes the `array` coercion that flattened glossary rows `{term, locale, displayName}` to `{name}`, corrupting existing glossary fields.
