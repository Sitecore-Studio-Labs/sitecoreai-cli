/**
 * Internal media-type table — the two lookups the recipe media-upload
 * planner needs, with NO external `mime` dependency.
 *
 * Exists because of the mime v4 incidents (plural): the `mime` package
 * went ESM-only at v4, and a dependabot major bump twice shipped a CJS
 * `dist/` that dies with `ERR_REQUIRE_ESM` in consumers whose loaders
 * don't support `require(esm)` (the orchestrator's Vercel functions) —
 * while CI stayed green because modern Node CAN `require()` ESM. The
 * durable fix is to not depend on `mime` at all: the planner only ever
 * maps the media formats Sitecore's media library handles, and this
 * table covers exactly those. Unknown types degrade the same way the
 * library calls did (`null` → caller falls back to `bin` / the default
 * MIME type). The companion guard is `scripts/smoke-require.cjs` run
 * with `--no-experimental-require-module`, which makes CI reproduce a
 * strict-CJS consumer for every remaining dependency.
 *
 * Extension casing: lookups are case-insensitive; returned extensions
 * are lowercase. `image/jpeg` maps back to `jpeg` (not `jpg`) to match
 * what `mime.getExtension` historically returned here — Sitecore's
 * MediaCreator treats both as the Jpeg template, but keeping the same
 * string keeps uploaded file names byte-stable across versions.
 */

/** Extension (lowercase, no dot) → MIME type. First entry per MIME type
 *  is the PREFERRED extension `extensionForMediaMimeType` returns. */
const EXTENSION_TO_MIME: ReadonlyArray<readonly [string, string]> = [
  // Images — the dominant media-upload shape (brand imagery).
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["svg", "image/svg+xml"],
  ["ico", "image/x-icon"],
  ["bmp", "image/bmp"],
  ["tiff", "image/tiff"],
  ["tif", "image/tiff"],
  // Video / audio.
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["m4v", "video/x-m4v"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  // Documents / fonts occasionally staged as media assets.
  ["pdf", "application/pdf"],
  ["json", "application/json"],
  ["txt", "text/plain"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
];

const byExtension = new Map(EXTENSION_TO_MIME);
const byMimeType = new Map<string, string>();
for (const [extension, mimeType] of EXTENSION_TO_MIME) {
  if (!byMimeType.has(mimeType)) byMimeType.set(mimeType, extension);
}
// Aliases seen in the wild that must resolve to the same extension.
byMimeType.set("image/vnd.microsoft.icon", "ico");
byMimeType.set("audio/x-wav", "wav");

/**
 * MIME type implied by a file path's extension, or `null` when the
 * extension is absent/unrecognized (caller keeps its default).
 * Mirrors the old `mime.getType(path)` call sites.
 */
export const mediaMimeTypeForPath = (filePath: string): string | null => {
  const leaf = filePath.split(/[/\\]/).pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = leaf.slice(dot + 1).toLowerCase();
  return byExtension.get(extension) ?? null;
};

/**
 * Preferred file extension for a MIME type (lowercase, no dot), or
 * `null` when unrecognized (caller falls back to `bin`). Mirrors the
 * old `mime.getExtension(type)` call sites; tolerates a charset suffix.
 */
export const extensionForMediaMimeType = (mimeType: string): string | null => {
  const bare = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return byMimeType.get(bare) ?? null;
};
