---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: pair `UsePlaceholderDatasourceContext=true` with dynamic placeholders + skip phantom data templates for pure-layout renderings

Two follow-ups to the Placeholders shared-field fix that round out the
dynamic-placeholder chain so scai-emitted renderings match the SXA / XM
Cloud starter Container shape end-to-end.

**`UsePlaceholderDatasourceContext=true`** is now written alongside
`IsRenderingsWithDynamicPlaceholders=true` in OtherProperties whenever
`dynamicPlaceholders: true`. Without it, children dropped into a
Container / Section Wrapper / partial-design slot can lose their
relative-datasource binding when the layout service serialises the
placeholder map — the parent-context binding gets dropped and child
renderings resolve against the page root instead of the parent
datasource. Both properties ride with the dynamic-placeholder chain on
the XM Cloud starter Container rendering; both are needed.

**Pure-layout renderings now skip data-template emission.** A recipe
with no `fields:` and no `insertOptions:` (e.g. Container,
ColumnSplitter, RowSplitter, SectionWrapper, partial designs)
previously emitted a phantom empty data template at
`<componentsRoot>/<section>/<Name>` — orphan, never referenced (the
rendering's Datasource Template shared field was already omitted for
the same case). The XM Cloud starter Container has only a Rendering
item + Parameters Template; no template in the templates tree.
`emitDatasourceTemplate` is now gated on `hasInlineFields ||
hasInsertOptions` so layout-only recipes match the starter shape.

Recipes that bind content (`fields: [...]`) or compose child items via
`insertOptions: [...]` still emit a data template — only the
fields-empty + insertOptions-empty case is skipped.
