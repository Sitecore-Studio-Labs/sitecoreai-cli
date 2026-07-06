---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Make recipe push resilient to unregistered languages. When a recipe fans
content across locales — dictionary translations, or component
`__Standard Values` locale-map defaults — into a language the target
environment hasn't provisioned, the Authoring API rejects that language's
version write. The executor now skips just that non-primary-language op
(surfacing it as an `apply-skip` event and a `skip` in the summary) and
continues, instead of aborting the whole push and rolling back. The
primary language and every registered locale still install. A version
write that fails for any other reason — or on the primary language — still
aborts as before.
