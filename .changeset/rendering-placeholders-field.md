---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: write `Placeholders` shared field on Rendering items

`ComponentTemplateRecipe`'s `placeholders: [...]` block previously only
emitted `Placeholder Settings` items at `placeholderSettingsRoot` —
which carry per-key allow-lists and editor-toolbox metadata. It never
wrote the placeholder keys back to the Rendering item's own
`Placeholders` shared field.

That field is what SXA Headless reads to enumerate the slots on a
rendering. Without it the layout service emits no `placeholders` map
for the rendering, and the headless SDK's `getPlaceholderRenderings`
walks an empty object and warns

    Placeholder '<slot>-1' was not found in the current rendering data

even when the recipe correctly set `dynamicPlaceholders: true`,
chained the `_IDynamicPlaceholder` base template, and registered the
slot's Placeholder Settings item. The two earlier fixes were
necessary-but-not-sufficient — this third write completes the chain.

`emitRendering` now writes each recipe-declared `slot.key` verbatim
(pipe-joined for multi-slot renderings) into
`b687328e-ca12-414d-a78e-6b4e6dca38fa`. The literal `{*}` token
survives into the field value because the SDK's runtime substitution
path expects exactly that template form
(`getDynamicPlaceholderPattern` builds `/^<prefix>-\d+$/` from the
`{*}`-bearing key).

```ts
// Single slot
{
  placeholders: [{ key: "container-{*}" }],
}
// → Placeholders shared field = "container-{*}"

// Multi-slot
{
  placeholders: [
    { key: "header-start-{*}" },
    { key: "header-nav-{*}" },
    { key: "header-end-{*}" },
  ],
}
// → Placeholders shared field = "header-start-{*}|header-nav-{*}|header-end-{*}"
```
