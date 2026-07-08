---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix media uploads landing with an empty `Extension` field (blob won't render / "won't upload"). Sitecore derives a media item's `Extension` and `Mime Type` from the multipart file part, not from the item name or the `uploadMedia` mutation input — so an extensionless filename (an `external-url` tail with none, or the bare `"media"` fallback) produced a media item that never served. `uploadMedia` now runs the filename + MIME through `resolveMediaUpload`, which guarantees the multipart filename carries an extension (derived from the MIME type when the source name lacks one) and forwards a canonical image MIME type.
