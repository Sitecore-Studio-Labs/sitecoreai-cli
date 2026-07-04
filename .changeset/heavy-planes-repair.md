---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix external image URLs in recipe image fields. The compiler now emits fully-qualified `http(s)` URLs as the image XML's `src=` attribute (the form the Layout Service surfaces as a renderable `src`) instead of `mediapath=`, matching the standard-values encoder. The read-current reverse projection now decodes both the `mediapath=` and `src=` forms, so external-URL images (e.g. dicebear avatars) survive content sync instead of being silently dropped.
