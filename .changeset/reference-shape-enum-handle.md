---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: honour `sitecore.enumHandle` on `shape: "reference"` (Treelist pick-from-enum)

Previously `enumHandle` only worked on `shape: "enum"` (single-select
Droplink). For multi-pick scenarios — "pick which social platforms to
show", "pick which feature flags this site enables" — authors had to
fall back to a free-text comma-separated convention because the
recipe DSL couldn't express "Treelist sourced from this enum".

Now `enumHandle` works on `shape: "reference"` too. Both branches use
the same enum folder path resolution; the reference branch additionally
restricts the picker to enum value items via
`IncludeTemplatesForSelection`:

```ts
// Single-pick Droplink (existing behaviour, unchanged):
{ name: "Platform", shape: "enum",
  sitecore: { enumHandle: "social-platform@1" } }
// → Source: /sitecore/.../Enumerations/SocialPlatform

// Multi-pick Treelist (NEW):
{ name: "Platforms", shape: "reference", multiple: true,
  sitecore: { type: "treelist", enumHandle: "social-platform@1" } }
// → Source: DataSource=/sitecore/.../Enumerations/SocialPlatform
//           &IncludeTemplatesForSelection={<enum-value-template-GUID>}
```

Standard Values defaults follow the same rules:

```ts
// Single-pick default = enum value name:
{ ..., default: "x" }
// → SV value = ref-recipe pointing at enumValueId(folder, "x")

// Multi-pick default = pipe-separated enum value names:
{ ..., default: "facebook|x|linkedin" }
// → SV value = ref-recipe-list pointing at the three enum values
```

Same author-error contract as enum-shape SV defaults: referencing a
value name the enum doesn't define fails at apply time with the
standard "ref-recipe target not in captured-itemId map" error.

Tests: 5,147 passing (+3 covering the new branches).
