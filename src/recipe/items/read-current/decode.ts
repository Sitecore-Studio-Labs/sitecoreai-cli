/**
 * Wire-format decoders for the reverse-projection (`read-current`).
 *
 * The inverse of `layout/emit` + the compiler's field-value encoding: each
 * decoder takes a raw Sitecore field value (a date wire string, an XML blob,
 * a pipe-separated GUID list) and reconstructs the typed recipe payload.
 * `decodeContentFieldValue` is the dispatcher — it routes one raw value to
 * the right per-shape decoder via a `FieldShape`-keyed handler table.
 *
 * Every decoder is conservative: when the wire value isn't decodable under
 * its shape (empty / malformed / handle unrecoverable) it returns
 * `undefined`/`null` so the caller drops the field rather than fabricate a
 * shape-violating value. See `../read-current.ts` for the lossy contract.
 */

import type { ContentFieldValue } from "../../schema/recipe";
import type { FieldShape } from "../../schema/field-types";
import { normalizeGuid, type GuidHandleIndex } from "./helpers";

/**
 * Decode a Sitecore wire-format datetime (`yyyyMMddTHHmmssZ`) back to an
 * ISO 8601 string. Inverse of `toSitecoreDate` in `compile/content-item.ts`:
 * `kind: "date"` returns `YYYY-MM-DD`, `"datetime"` returns
 * `YYYY-MM-DDTHH:mm:ssZ`. Returns `undefined` when the wire string doesn't
 * match the expected shape — the caller drops the field rather than fabricate.
 */
export const decodeSitecoreDateToIso = (
  wire: string,
  kind: "date" | "datetime"
): string | undefined => {
  const m = wire.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return undefined;
  const [, yyyy, MM, dd, HH, mm, ss] = m;
  if (kind === "date") return `${yyyy}-${MM}-${dd}`;
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}Z`;
};

/** Inverse of the `escapeXmlAttr` the compiler uses on XML attribute values. */
const unescapeXmlAttr = (s: string): string =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

const matchAttr = (xml: string, name: string): string | undefined => {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(xml);
  return m ? unescapeXmlAttr(m[1]) : undefined;
};

/**
 * Decode the Page Designs root's `TemplatesMapping` field into a list of
 * `{ templateGuid, designGuid }` pairs. Inverse of
 * `encodeTemplatesMapping` (`layout/templates-mapping.ts`): the field
 * stores `{tplGuid}={designGuid}&…` URL-encoded.
 */
export const decodeTemplatesMapping = (
  raw: string
): Array<{ templateGuid: string; designGuid: string }> => {
  const entries: Array<{ templateGuid: string; designGuid: string }> = [];
  for (const pair of raw.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const templateGuid = normalizeGuid(decodeURIComponent(pair.slice(0, eq)));
    const designGuid = normalizeGuid(decodeURIComponent(pair.slice(eq + 1)));
    if (templateGuid && designGuid) entries.push({ templateGuid, designGuid });
  }
  return entries;
};

/**
 * Decode an `<image mediapath="…" alt="…" width="…" height="…" />` blob
 * into the image-shape `ContentFieldValue` payload. Returns `undefined`
 * when the blob is not a recognisable image element (caller drops the
 * field).
 *
 * The path is read from `mediapath` (media-library form) first, falling
 * back to `src` — the attribute Sitecore stores for external-URL images
 * and the form both scai encoders emit for fully-qualified URLs (the
 * standard-values encoder always did; `encodeImageXml` since the
 * external-URL fix). Without the fallback, every external-URL image was
 * silently dropped from the reverse projection, so synced copies lost
 * images that Pages still showed. Round-trip is stable: an `src=` URL
 * decodes into `mediaPath` and re-encodes as `src=` because
 * `encodeImageXml` dispatches on the URL shape.
 */
export const decodeImageXml = (
  xml: string
): { mediaPath: string; alt?: string; width?: number; height?: number } | undefined => {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<image")) return undefined;
  const nonEmptyAttr = (name: string): string | undefined => {
    const value = matchAttr(trimmed, name);
    return value === undefined || value === "" ? undefined : value;
  };
  const mediaPath = nonEmptyAttr("mediapath") ?? nonEmptyAttr("src");
  if (mediaPath === undefined) return undefined;
  const out: { mediaPath: string; alt?: string; width?: number; height?: number } = { mediaPath };
  const alt = matchAttr(trimmed, "alt");
  if (alt !== undefined) out.alt = alt;
  const widthRaw = matchAttr(trimmed, "width");
  if (widthRaw !== undefined) {
    const n = Number.parseInt(widthRaw, 10);
    if (Number.isFinite(n) && n > 0) out.width = n;
  }
  const heightRaw = matchAttr(trimmed, "height");
  if (heightRaw !== undefined) {
    const n = Number.parseInt(heightRaw, 10);
    if (Number.isFinite(n) && n > 0) out.height = n;
  }
  return out;
};

/**
 * Decode an external General-Link XML blob into the link-external-shape
 * payload. Returns `undefined` when the blob is not a `linktype="external"`
 * `<link>` element (caller branches to link-internal or drops the field).
 */
export const decodeExternalLinkXml = (
  xml: string
): { href: string; text?: string; target?: string; title?: string } | undefined => {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<link")) return undefined;
  const linktype = matchAttr(trimmed, "linktype");
  if (linktype !== "external") return undefined;
  const url = matchAttr(trimmed, "url");
  if (url === undefined || url === "") return undefined;
  const out: { href: string; text?: string; target?: string; title?: string } = { href: url };
  const text = matchAttr(trimmed, "text");
  if (text !== undefined) out.text = text;
  const target = matchAttr(trimmed, "target");
  if (target !== undefined) out.target = target;
  const title = matchAttr(trimmed, "title");
  if (title !== undefined) out.title = title;
  return out;
};

/**
 * Decode an internal General-Link XML blob — `linktype="internal"` with an
 * `id="{guid}"` pointing at the target item. Returns `undefined` when the
 * blob is not an internal link or the target GUID has no marker (handle
 * unrecoverable — caller drops the field rather than fabricate).
 */
export const decodeInternalLinkXml = (
  xml: string,
  guidIndex: GuidHandleIndex
): { ref: string; text?: string; target?: string } | undefined => {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<link")) return undefined;
  const linktype = matchAttr(trimmed, "linktype");
  if (linktype !== "internal") return undefined;
  const idRaw = matchAttr(trimmed, "id");
  if (idRaw === undefined || idRaw === "") return undefined;
  const ref = guidIndex.get(normalizeGuid(idRaw));
  if (ref === undefined) return undefined;
  const out: { ref: string; text?: string; target?: string } = { ref };
  const text = matchAttr(trimmed, "text");
  if (text !== undefined) out.text = text;
  const target = matchAttr(trimmed, "target");
  if (target !== undefined) out.target = target;
  return out;
};

/**
 * Per-shape decoder: one raw Sitecore field value → a typed
 * `ContentFieldValue`, or `null` when the value isn't decodable under that
 * shape. The dispatch table below maps every `FieldShape` to one of these.
 */
type ShapeDecoder = (raw: string, guidIndex: GuidHandleIndex) => ContentFieldValue | null;

const decodeReference: ShapeDecoder = (raw, guidIndex) => {
  const refs: string[] = [];
  for (const guid of raw.split("|")) {
    const norm = normalizeGuid(guid);
    if (!norm) continue;
    const handle = guidIndex.get(norm);
    if (handle !== undefined) refs.push(handle);
  }
  return refs.length > 0 ? { shape: "reference", refs } : null;
};

const decodeLink: ShapeDecoder = (raw, guidIndex) => {
  const ext = decodeExternalLinkXml(raw);
  if (ext !== undefined) return { shape: "link-external", ...ext };
  const internal = decodeInternalLinkXml(raw, guidIndex);
  if (internal !== undefined) return { shape: "link-internal", ...internal };
  return null;
};

/**
 * `FieldShape` → decoder dispatch table. Replaces the former `switch` over
 * the shape token: each entry is a small handler that turns one raw value
 * into a typed `ContentFieldValue` (or `null` to drop). `text`/`richText`
 * carry the shape through so a single handler serves both.
 */
const SHAPE_DECODERS: Record<FieldShape, ShapeDecoder> = {
  text: (raw) => ({ shape: "text", value: raw }),
  richText: (raw) => ({ shape: "richText", value: raw }),
  enum: (raw) => (raw === "" ? null : { shape: "enum", value: raw }),
  boolean: (raw) => ({ shape: "boolean", value: raw === "1" }),
  number: (raw) => {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? { shape: "number", value: n } : null;
  },
  integer: (raw) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? { shape: "integer", value: n } : null;
  },
  date: (raw) => {
    const iso = decodeSitecoreDateToIso(raw, "date");
    return iso === undefined ? null : { shape: "date", value: iso };
  },
  datetime: (raw) => {
    const iso = decodeSitecoreDateToIso(raw, "datetime");
    return iso === undefined ? null : { shape: "datetime", value: iso };
  },
  image: (raw) => {
    const img = decodeImageXml(raw);
    return img === undefined ? null : { shape: "image", ...img };
  },
  link: decodeLink,
  reference: decodeReference,
};

/**
 * Decode one raw Sitecore field value back to a typed `ContentFieldValue`
 * dispatched by the field's declared abstract `FieldShape`. Returns `null`
 * when the value isn't decodable under that shape (empty / malformed /
 * handle unrecoverable) — the caller drops the field rather than emit a
 * shape-violating value.
 *
 * The `FieldShape` taxonomy has `"link"` (the abstract data shape). The
 * recipe `ContentFieldValue` discriminates `"link-external"` vs
 * `"link-internal"` at the value level — the `link` decoder picks the right
 * branch by inspecting the XML's `linktype`. An internal link whose GUID
 * has no marker resolves to `null` and is dropped (no fabricated handle).
 */
export const decodeContentFieldValue = (
  raw: string,
  shape: FieldShape,
  guidIndex: GuidHandleIndex
): ContentFieldValue | null => SHAPE_DECODERS[shape](raw, guidIndex);
