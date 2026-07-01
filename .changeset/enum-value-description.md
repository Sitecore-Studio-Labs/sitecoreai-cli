---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(recipe): per-value `description` on enumeration values for AI-guided param selection

`EnumerationValueSchema` now accepts an optional `description` alongside `name`
and `displayName`. It answers _when to pick this value over its siblings_ — the
discriminating context a bare `displayName` can't carry (e.g. why choose
`link-arrow` over `link` for a CTA). The compiler lands it on the value item's
shared `__Help text` field, so it surfaces in the Content Editor tooltip AND
travels in the published recipe JSON that page-composing agents read over HTTP.

Additive and backward-compatible: description-free values compile byte-for-byte
as before (the help-text field is only emitted when set), so existing
enumerations don't churn. `displayName` labels the option; `description` says
when to use it.
