---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**New CLI verb: `scai explain why-blocked <itemId>` — answer the "why won't this delete?" question with one call.**

The Authoring API rejects delete requests with terse messages like
"Template is used by at least one item" or "Item is referenced by
other items" — enough to know something is wrong, not enough to
know what. Operators were piecing together the picture by hand:
`audit references` → `audit template-dependencies` → cross-reference
field names → guess. Agents couldn't even start because they didn't
know to compose those two audits in the first place.

`explain why-blocked` does the composition once:

```bash
$ scai explain why-blocked {ABC-DEF-...}
abcdef0123456789abcdef0123456789 is blocked by 5 inbound reference(s):
  1 base-template, 1 insert-options, 3 field-value.
  - [base-template] /sitecore/templates/Project/Inheritor
  - [insert-options] /sitecore/templates/Project/Folder/__Standard Values
  - [field-value] /sitecore/content/Home . Body
  - [field-value] /sitecore/content/Home . RelatedItems
  - [field-value] /sitecore/content/Article . MainImage
```

Internally it invokes both `runAuditReferences` and
`runAuditTemplateDependencies` in parallel (each with `silent: true`,
so the verb owns its own printed report), merges the findings into
one list, and sorts them via `REFERENCE_KIND_PRIORITY` so structural
blockers (base-template, insert-options, …) surface ahead of plain
field-value refs — the operator's first triage decision is "what's
the worst blocker?"

Skip flags for perf:

- `--skip-content-scan` — drop the slow field-value walk, only check
  structural template-dependency refs. Useful when the target is
  known to be a template.
- `--skip-template-deps` — drop the five search-index queries, only
  scan field values. Useful when the target is a leaf content item
  that no template should reference.

Output is the canonical `ScaiEnvelope` (`command:
"explain.why-blocked"`, `data: { itemId, blockers: [...] }`, summary

- meta). 6 unit tests in
  `tests/unit/hygiene/tasks/explain-why-blocked.test.ts` pin the merge
- sort + skip-flag behavior.
