---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Resolve the environment's registered languages for pushes that carry
component `__Standard Values` locale-map defaults — not only for pushes
that carry a dictionary.

The compiler fans a bare base-language default key (`ar`) out to the
tenant's registered regional variants (`ar-AE`, `ar-SA`) only when
`availableLanguages` is known; otherwise it falls back to the
standalone-compile path and emits each key **verbatim**. Language
resolution was gated on the presence of a `dictionary` recipe, so a
**component-only push** (component recipes with SV locale maps, no
dictionary in the set) resolved no languages and wrote the localized SV to
the bare `ar` version — a language the site never renders — instead of the
regional `ar-AE` it actually uses. A dictionary pushed separately resolved
its own languages and landed correctly on `ar-AE`, which is why the two
diverged.

`recipe push` now also resolves environment languages when any
component-/content-template recipe in the set authors a per-locale
`default` (or `sitecore.defaultValue`) locale map, so the base-language
fan-out targets the tenant's registered regional variants regardless of
whether a dictionary is in the same push. Best-effort and idempotent, same
as the existing dictionary path.
