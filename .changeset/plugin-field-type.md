---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`recipe`: add `Plugin` Sitecore field type + `plugin` source variant for Marketplace custom-field apps

Two related additions to the field-augment surface, both needed before a
recipe can wire a Sitecore template field to a Sitecore Marketplace
custom-field plugin (e.g. the new `@sai/matrix-editor`):

- **`type: "Plugin"`** joins the `SITECORE_FIELD_TYPES` enum. Stored
  verbatim in the field item's `Type` shared field — the Marketplace
  shell renders the custom plugin iframe instead of any built-in
  editor.
- **`source: { kind: "plugin", id: "<slug>" }`** is the third variant on
  the `SitecoreFieldSourceSchema` discriminated union (alongside
  `filter` and `raw`). The compiler emits the slug verbatim into the
  field's `Source` property; the Marketplace looks it up against its
  installed-plugins catalog at render time to resolve the iframe URL.

Example — adding the matrix editor plugin to `matrix.recipe.ts`:

```ts
{
  name: "EditMatrix",
  shape: "text",                 // field stores a digest string
  sitecore: {
    type: "Plugin",
    source: { kind: "plugin", id: "sai/matrix-editor" },
    hint: "Visual editor for this matrix's rows, columns, and cells.",
    section: "Editor",
    sortOrder: 50,
  },
}
```

Internals: `augmentSourceToFields` maps the new variant to a
`sourcePlugin` entry on the flat `SourceFields` bag; `renderSourceFields`
returns the slug verbatim (same precedence semantics as `sourceRaw`,
which already overrides everything else). `defaultSitecoreFieldType` is
unchanged — Plugin is opt-in only, never inferred from a `shape`.

Pull-side round-tripping (`recipe pull`) currently rebuilds plugin
sources as `kind: "raw"`; the slug round-trips correctly but loses the
plugin-vs-raw distinction. A follow-up can teach `read-current.ts` to
detect `Type=Plugin` and emit the structured `kind: "plugin"` form.
