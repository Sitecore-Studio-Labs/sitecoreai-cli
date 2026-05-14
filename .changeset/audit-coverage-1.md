---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Four new `scai audit` verbs — field-level quality checks.** Built
on the Phase A substrate; all four honor `--baseline`, `--output`,
`--exclude`, `--since`, and the perf knobs.

- `audit large-fields list --threshold <bytes>` — items with field
  values exceeding the threshold (default 100KB). Surfaces
  Word-pasted RichText, base64-embedded images, raw JSON dumps.
  Reports per-field size + total bloat per item.
- `audit heavy-templates list --threshold <count>` — templates
  with more than N fields (default 50). Counts fields by walking
  section → field children; correlates with slow editor renders +
  brittle fixtures.
- `audit missing-meta list --required-fields <names>` — items lacking
  required (SEO) fields. Defaults to `meta-title,meta-description,
og-image,og-title`; configurable via `--required-fields`. Scope to
  Page templates with `--template-pattern Page`. Field-name matching
  tolerates space/hyphen variants ("Meta Description" matches
  "meta-description").
- `audit alt-text-missing list` — Image-field values with empty or
  missing alt text. Pure regex scan over Image-field XML; per-field
  granularity in the report. Decorative `alt=""` cases need
  baseline ignore.

All four are also part of `audit all` — running the meta-command
now invokes 17 audits (up from 13) by default.

11 new unit tests (160 total in hygiene module). Live-validated all
four verbs against the sandbox tenant.
