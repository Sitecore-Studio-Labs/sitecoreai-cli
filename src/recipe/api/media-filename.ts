/**
 * Multipart filename helpers for media-library uploads.
 *
 * Sitecore derives a media item's `Extension` field from the extension of the
 * `file` part in the multipart upload — NOT from the item name (which is
 * intentionally extensionless, see `UploadMediaInput.itemPath`) and NOT from
 * any `uploadMedia` GraphQL mutation input. So if the multipart filename has
 * no extension, the resulting media item's `Extension` field is left empty and
 * the blob won't serve with the right content type — the image reads as broken
 * / "won't upload".
 *
 * This most often bites `external-url` media sources whose URL path tail
 * carries no extension (CDN / query-style URLs like `.../photo-abc123`), and
 * the bare `"media"` fallback. `ensureMediaFileName` guarantees the multipart
 * filename carries an extension, deriving one from the MIME type when the
 * source name lacks one.
 */

/** Common image MIME types → canonical file extension (no dot). */
const MIME_EXTENSION: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/**
 * Best-effort file extension (no dot) for a MIME type. Falls back to the
 * subtype (`image/svg+xml` → `svg`, dropping any `+suffix` and `;params`),
 * then to `png` when nothing usable can be derived.
 */
export const extensionForMime = (mimeType: string): string => {
  const mime = mimeType.trim().toLowerCase();
  const mapped = MIME_EXTENSION[mime];
  if (mapped) return mapped;
  const subtype = mime.split("/")[1]?.split(";")[0]?.split("+")[0]?.trim();
  return subtype && /^[a-z0-9]+$/.test(subtype) ? subtype : "png";
};

/**
 * Whether `fileName` already ends in a plausible file extension: a dot with at
 * least one trailing char, not at position 0 (dotfiles like `.env` are names,
 * not extensions), and an alphanumeric extension token.
 */
const hasFileExtension = (fileName: string): boolean => {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return false;
  return /^[a-z0-9]+$/i.test(fileName.slice(dot + 1));
};

/**
 * Return a multipart filename guaranteed to carry a file extension so Sitecore
 * populates the media item's `Extension` field. When `fileName` already has
 * one it is returned unchanged; otherwise an extension derived from `mimeType`
 * is appended.
 */
export const ensureMediaFileName = (fileName: string, mimeType: string): string =>
  hasFileExtension(fileName) ? fileName : `${fileName}.${extensionForMime(mimeType)}`;

/**
 * Canonical file extension (no dot) → image MIME type. Inverse of
 * `MIME_EXTENSION`; used to override a bizarre or absent upload `Content-Type`
 * with the type implied by the (guaranteed) file extension, so Sitecore stores
 * a sane `Mime Type` field. Non-image extensions are intentionally absent —
 * those keep the caller-supplied MIME type.
 */
const MIME_FOR_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
};

/**
 * Canonical image MIME type for a file extension (dot optional), or `undefined`
 * when the extension isn't a known image type.
 */
export const mimeForExtension = (ext: string): string | undefined =>
  MIME_FOR_EXTENSION[ext.trim().toLowerCase().replace(/^\./, "")];

/**
 * Resolve the multipart filename AND MIME type for a media upload so Sitecore
 * derives a correct `Extension` and `Mime Type` on the created item.
 *
 * The filename is guaranteed to carry an extension (`ensureMediaFileName`), and
 * the MIME type is then taken from that extension's canonical image type — so a
 * junk `Content-Type` forwarded from an `external-url` CDN (e.g.
 * `application/octet-stream`) is replaced by the type the extension implies.
 * Only when the extension isn't a known image type is the caller-supplied
 * `mimeType` kept (covers non-image media like PDFs).
 */
export const resolveMediaUpload = (
  fileName: string,
  mimeType: string
): { fileName: string; mimeType: string } => {
  const resolvedName = ensureMediaFileName(fileName, mimeType);
  const dot = resolvedName.lastIndexOf(".");
  const ext = dot >= 0 ? resolvedName.slice(dot + 1) : "";
  return { fileName: resolvedName, mimeType: mimeForExtension(ext) ?? mimeType };
};
