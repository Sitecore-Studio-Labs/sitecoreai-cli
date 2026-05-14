---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Blocker reports in `cleanup subtree` and `cleanup site-residue` now categorize each inbound reference by structural kind.**

Both cleanups already scanned every field on every active item, so
they already caught structural references (`_basetemplates`,
`__masters`, `__source`, `_template`, `datasource template`) as
"this field's value mentions the target." What they didn't do was tell
the operator _which kind_ of reference — a "field X" line read the
same whether the blocker was a base-template inheritance (deleting it
orphans every inheritor's fields) or a generic content link
(recoverable: clear the field).

Each `InboundBlocker` (subtree) and `InboundRef` (site-residue) now
carries a `referenceKind` derived from the field name:

- `primary-template` — `_template`
- `base-template` — `_basetemplates`
- `insert-options` — `__masters`
- `branch-source` — `__source`
- `datasource-template` — `datasource template` (rendering type-gate)
- `field-value` — everything else (the catch-all for generic refs)

The subtree command's block-mode error message now prefixes each
sample line with the kind, sorted so structural blockers (base-
template, insert-options) surface ahead of plain field refs:

```
Refusing to delete subtree '/sitecore/templates/Project/MySite':
3 external reference(s) point into it.
  [base-template] /sitecore/templates/Project/Other/T1 . _basetemplates → abc12345…
  [insert-options] /sitecore/templates/Project/Other/Folder/__Standard Values . __masters → def67890…
  [field-value] /sitecore/content/Home . RelatedItems → 11223344…
```

A new `src/hygiene/tasks/reference-kind.ts` module exports
`classifyReferenceKind(fieldName)` and a `REFERENCE_KIND_PRIORITY`
table for sort ordering. The classifier is case-insensitive and
whitespace-tolerant. 5 unit tests in
`tests/unit/hygiene/tasks/reference-kind.test.ts` lock the mapping.
