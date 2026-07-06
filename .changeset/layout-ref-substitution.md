---
"sitecoreai-cli": minor
---

Layout XML now resolves against real tenant item ids, and variant selections reference their Variant Definition items:

- **Plan-time refKey substitution in string field values.** Layout XML is compiled with uuidv5 refKeys (`renderingId`, `contentItemId`, `variantId`) baked into the string, but the Authoring API mints its own item ids at create time — so every `s:id`/`ds` in a pushed layout pointed at an item id that doesn't exist on the tenant, and the layout service could never resolve the renderings (pages rendered empty even with a well-formed delta). `resolveRecipeRefs` now scans string values for GUID tokens and substitutes captured tenant ids (braced and bare/URL-encoded forms); non-captured GUIDs — device ids, Sitecore constants, tenant-pre-existing items — pass through untouched.
- **`FieldNames` references the headless Variant Definition item by GUID** when the component recipe declares the variant (the items the component compiler already emits under `Presentation/Headless Variants/<Component>`), matching XM Cloud Pages' own convention so its variant picker shows the selection; the layout service resolves the GUID back to the item's name for the front end's export lookup. Undeclared variants — and standalone compiles without `componentsByHandle` — keep the raw-name form.
