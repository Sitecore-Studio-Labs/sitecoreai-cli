---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: write `Placeholder` shared field on Rendering items

`ComponentTemplateRecipe`'s `placeholders: [...]` block previously only
emitted `Placeholder Settings` items at `placeholderSettingsRoot` —
which carry per-key allow-lists and editor-toolbox metadata. It never
wrote the placeholder keys back to the Rendering item's own
`Placeholder` shared field on the SXA Headless `Json Rendering`
template (singular — not the CMS-shaped `Placeholders` plural variant
on `System/Layout/Rendering`, which Headless renderings don't inherit).

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
(pipe-joined for multi-slot renderings) into the singular
`Placeholder` shared field at
`592a1ce7-abe0-4986-9783-0a34f3961dc0` (sandbox-verified by
introspecting the `Json Rendering` template at
`/sitecore/templates/Foundation/JavaScript Services/Json Rendering`
on the agents tenant). The literal `{*}` token survives into the
field value because the SDK's runtime substitution path expects
exactly that template form (`getDynamicPlaceholderPattern` builds
`/^<prefix>-\d+$/` from the `{*}`-bearing key).

```ts
// Single slot
{
  placeholders: [{ key: "container-{*}" }],
}
// → Placeholder shared field = "container-{*}"

// Multi-slot
{
  placeholders: [
    { key: "header-start-{*}" },
    { key: "header-nav-{*}" },
    { key: "header-end-{*}" },
  ],
}
// → Placeholder shared field = "header-start-{*}|header-nav-{*}|header-end-{*}"
```

> An unreleased first attempt (commit `885885c`) wrote against a
> guessed GUID for the CMS-shaped `Placeholders` plural variant
> (`b687328e-ca12-414d-a78e-6b4e6dca38fa`); Authoring GraphQL
> rejected every rendering upsert with "Cannot find a field with the
> name b687328e-...". Caught + fixed before any release shipped
> (commit `84fa785`).
