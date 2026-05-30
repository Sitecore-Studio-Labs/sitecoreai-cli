---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: encode `file`, `droplink`, `treelist`, and `treelist-with-search` Standard Values defaults

Rounds out SV default encoding so every common field shape can be
seeded from a recipe string. Authors no longer have to swap to a
"populate after deploy" workflow just to get a non-empty initial
field — every shape now has a path.

**`file`** (same convention as `image`):

```ts
{ name: "Document", shape: "image", sitecore: { type: "file" },
  default: "Whitepaper|https://example.com/wp.pdf" }
// → <file src="https://example.com/wp.pdf" alt="Whitepaper" />
```

**`reference` shape — single (Droplink)**: the default is a recipe
handle; the encoder resolves it to that handle's deterministic
`contentItemId(site, handle)` GUID and emits a `ref-recipe`:

```ts
{ name: "Author", shape: "reference", multiple: false,
  sitecore: { type: "droplink" },
  default: "author-jane@1" }
// → SV value = ref-recipe pointing at contentItemId(site, "author-jane@1")
```

**`reference` shape — multi (Treelist / Treelist-with-search)**: the
default is pipe-separated recipe handles; emits a `ref-recipe-list`:

```ts
{ name: "Authors", shape: "reference", multiple: true,
  sitecore: { type: "treelist" },
  default: "author-jane@1|author-bob@1" }
// → SV value = ref-recipe-list, refKeys = [contentItemId(...), ...]
```

The recipe set must materialise content items at the referenced
handles in the same compile run. If a handle doesn't resolve, the SV
write fails at apply time with the executor's standard "ref-recipe
target not in captured-itemId map" error — author error, not silently
masked. Same contract as enum-value defaults.

Tests: 5,144 passing (+5 covering file + single/multi reference +
empty-input safe handling).
