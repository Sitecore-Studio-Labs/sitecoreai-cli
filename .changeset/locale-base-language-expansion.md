---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Base-language keys in per-locale `__Standard Values` defaults now fan out to the environment's regional variants.

Building on the per-locale default maps from 0.21.0, a map key may now be a
**base language** (`de`, `ar`, `ja`) as well as a full regional code
(`de-DE`, `pt-BR`). Against a live environment, a base key resolves to every
registered regional variant of that language — each carrying the base value —
so a recipe authors one translation per language instead of one per region:

```ts
// environment registers de-DE, de-AT, de-CH
default: { en: "Get in touch", de: "Kontakt aufnehmen" }
// → de-DE, de-AT, de-CH all get "Kontakt aufnehmen"
```

- **Explicit regional keys override the base** for their exact locale, so the
  genuinely divergent splits stay authorable:
  `{ en, zh-CN: "搜索", zh-TW: "搜尋" }`, or
  `{ en, de: "…", "de-CH": "…" }` (every `de-*` gets the base copy except
  `de-CH`).
- Registered-code casing is preserved on the emitted version; a key that
  matches no registered language is dropped.
- Standalone compile (no environment) still emits every authored key verbatim.
- Plain-string defaults and exact-regional-only maps are unchanged.
