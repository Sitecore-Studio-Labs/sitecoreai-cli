---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: encode `image` Standard Values defaults from an `alt|src` URL string

`image`-shaped fields previously dropped their `default` value during SV
emission — the encoder returned `undefined` for every remaining
reference shape on the rationale that media-library item references
weren't expressible from a recipe string. That left every recipe with
a Media field rendering an empty image slot until an author manually
picked a media item.

The encoder now accepts a pipe-separated `"<alt>|<src>"` convention
(or a bare `"<src>"` with no pipe) and emits Sitecore's image-field
XML with the external-URL `src` form:

```ts
{ name: "Hero", shape: "image",
  default: "Hero placeholder|https://picsum.photos/seed/hero/1200/600" }

// → <image src="https://picsum.photos/seed/hero/1200/600" alt="Hero placeholder" />
```

Sitecore Layout Service surfaces the encoded value as `{ src, alt }`
in the image-field JSON the React side reads. Authors swap to a real
media-library item via the image picker at placement time; until they
do, the seeded src renders the placeholder image so dropped renderings
visualise immediately. Empty raw values or pipe-only with no src are
skipped — they'd produce a broken `<img src="">` otherwise.

`file`, `droplink`, `treelist`, and `treelist-with-search` are still
skipped — they need GUID payloads the string convention can't express.
Future work could resolve these against the recipe set's content
recipes (find the content item by handle, emit its deterministic GUID).
