---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: wire rendering Placeholders Treelist to the Placeholder Settings items it creates

`ComponentTemplateRecipe`'s `placeholders: [...]` block previously
only emitted `Placeholder Settings` items at `placeholderSettingsRoot`
— which carry per-key allow-lists and editor-toolbox metadata. The
matching wire on the Rendering item that joins those settings items
to the rendering was missing, so the layout service shipped no
`placeholders` array for the rendering, child renderings never
resolved, and the headless SDK warned

    Placeholder '<slot>-1' was not found in the current rendering data

even when the recipe correctly set `dynamicPlaceholders: true`,
chained the `_IDynamicPlaceholder` base template, and emitted every
Placeholder Settings item the slot needed.

`emitRendering` now writes the **Placeholders** (plural) Treelist
shared field at `069a8361-b1cd-437c-8c32-a3be78941446` — the SXA
Headless rendering-chain field, mixed in via
`/sitecore/templates/System/Layout/Sections/Rendering Options/Layout Service/Placeholders`.
Value is a `ref-recipe-list` of GUIDs, one per declared slot, each
pointing at the matching Placeholder Settings item already emitted
by `buildPlaceholderSettingsAggregate`:

```ts
{
  placeholders: [
    { key: "container-{*}" },
    { key: "footer-{*}" },
  ],
}
// → Placeholders Treelist refs:
//   [
//     placeholderSettingsId(site, "container-{*}"),
//     placeholderSettingsId(site, "footer-{*}"),
//   ]
```

The starter-kit `Container`, `Column Splitter`, `Row Splitter`, etc.
all wire their slots through this exact field — the SXA Headless
runtime dereferences each ref to read the `Placeholder Key` (the
`container-{*}` template-shaped string) before emitting the
`placeholders` map. The literal `{*}` token lives on the settings
item, not on the rendering field, which is why earlier attempts at
writing pipe-joined raw key strings to the rendering had no effect:
the runtime never reads the rendering for keys.

> Two unreleased earlier attempts at this fix targeted the wrong
> field entirely — commit `885885c` wrote pipe-joined keys to the
> standard CMS Layout's plural "Placeholders" (b687328e-...) which
> the Headless Json Rendering template doesn't inherit (Authoring
> GraphQL rejected the upsert outright); commit `84fa785` switched
> to the Json Rendering template's singular "Placeholder" field
> (592a1ce7-...) which Authoring accepts but the layout service
> ignores. Caught + corrected (this changeset / commit) before any
> release shipped: still 0.2.5 on `latest` after publishing.
