---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(brand): set the Glossary section's source language so synced terms render

A brand-kit glossary synced via scai showed no values in the Sitecore AI app
even though the term fields persisted. The app gates the Glossary terms table
behind the section-level `sourceLanguage` (`GlossarySection` → `hasSourceLanguage`);
scai read that property but never wrote it, so a freshly-synced kit rendered the
empty state and hid every term.

`diffBrandKit` now emits a `sectionProperty` change when a recipe's
`sectionProperties[section].sourceLanguage` differs from the live section, and
`apply` PATCHes it via a new `updateBrandKitSection()` (`PATCH /api/brands/v1/.../sections/{id}`,
body `{ properties: { sourceLanguage } }`) before writing the section's term
fields. The field-value write shape was already correct (verified live) — this
only adds the missing section-level source language.
