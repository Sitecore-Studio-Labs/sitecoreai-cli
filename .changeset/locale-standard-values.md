---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Support per-locale `__Standard Values` defaults on component / parameter fields.

A field or parameter `default` (and `sitecore.defaultValue`) now accepts a
locale map in addition to a plain string:

```ts
default: { en: "Get in touch", "de-DE": "Kontakt aufnehmen", "fr-FR": "Contactez-nous" }
```

The compiler materialises one `__Standard Values` version per locale — the
primary language (`en`) rides on the SV `CreateItem`, and each additional
locale is emitted as an `AddItemVersion` + versioned `SetField` (the same
language-version pattern the dictionary compiler uses). This lets
template-specific default _content_ localise without routing through a shared
dictionary.

- **Only text / rich-text shapes.** A locale map on any other shape
  (enum / reference / image / boolean / number) is rejected with
  `INPUT_INVALID` — a GUID reference, image, or numeric default can't vary by
  language. The map must include the primary language (`en`).
- **Filtered to the environment's languages.** Non-primary locales are matched
  case-insensitively against `context.availableLanguages` (Sites API
  `listLanguages`, the same source the dictionary filter uses), so a template
  installs SV versions only in the brand's languages and never adds a version
  in an unregistered locale. A standalone compile (no live environment) emits
  every authored locale.
- **Backward compatible.** A plain-string `default` is unchanged — it sets the
  primary-language version exactly as before.
