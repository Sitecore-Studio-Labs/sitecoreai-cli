---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Layout XML now binds placements with Sitecore's real placeholder attribute — `ph` (canonical) / `s:ph` (delta) — instead of the invalid `placeh`/`s:placeh`, which Sitecore stored verbatim but never bound, so pushed pages rendered empty until a first save in Pages rewrote the XML. The parser still accepts the legacy `placeh` forms already written to tenants. A page's canonical `__Final Renderings` also carries its own `l="{JSON layout}"` device pointer now: the canonical form fully replaces the template's standard-values layout, so without it the page had no layout definition at all.
