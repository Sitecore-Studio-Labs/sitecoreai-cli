---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: encode `general-link` Standard Values defaults from a `text|url` string

`general-link` fields previously dropped their `default` value during SV
emission — the encoder returned `undefined` for every reference-shape
type, on the rationale that they "need encoded payloads not expressible
via the simple `default: string` recipe surface". That left
recipe-authored CTAs landing with empty Link fields, so dropped
renderings showed empty button shells until an author manually filled
the link.

The encoder now parses a pipe-separated `"<text>|<url>"` convention and
emits the Sitecore link-field XML payload Standard Values stores
natively. `linktype` is inferred from the URL prefix: `mailto:` →
`mailto`, leading `#` → `anchor`, anything else → `external` (Sitecore
runtime renders relative paths and absolute URLs identically; the link
picker decides internal vs external at author-time for items it can
resolve). Either half of the pipe may be empty (`"Click|"` → text only,
`"|https://x"` → url only); a value with no pipe is treated as text +
anchor `#`. Attribute values are XML-escaped.

```ts
// Before: dropped silently.
{ name: "Link", shape: "link", sitecore: { type: "general-link" },
  default: "Get started|https://example.com" }

// After: SV emits
//   <link text="Get started" linktype="external" url="https://example.com" />
```

`image`, `file`, `droplink`, `treelist`, and `treelist-with-search`
defaults are still skipped — they need richer payloads (GUID references
to media items / content items) that don't have an obvious string
convention. Use the existing per-item content recipes to seed those.
