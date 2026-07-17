---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Partial-design layout: emit the SHARED `__Renderings` as a self-contained device layout instead of an inherit-delta. A partial design opened directly in XM Cloud Pages (not composed into a page) has no base device layout to merge a `<p:da name="l" />` delta against, so the CM layout service 500'd and Pages fell back to `nolayout.aspx` — the partial was uneditable standalone. The layout now emits an explicit `<d id="{DEVICE}">` element with anchor-less renderings (byte-identical to a Pages-authored partial design's `__Renderings`), so partials render and edit standalone.
