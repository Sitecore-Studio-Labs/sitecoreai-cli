import { contentItemId, enumerationFolderId, enumValueId, fieldId } from "../items/guids";
import {
  type AddItemVersionOp,
  type FieldValue,
  type Operation,
  type PushPolicy,
  type RefValue,
  type SetFieldOp,
} from "../ir/operations";
import { DEFAULT_LANGUAGE, DEFAULT_VERSION } from "../ir/sitecore-templates";
import { type FieldDefinition, type DesignParameter } from "../schema/recipe";
import { type SitecoreFieldType } from "../schema/field-types";
import { createScaiError } from "@/shared/errors";
import { resolveSitecoreType } from "./shared";
import { externalImageMediaRef, type ImageMediaSink, isExternalMediaUrl } from "./media";

/**
 * Build the field-default entries for a template's `__Standard Values`
 * item. Each entry carries the field's recipe-derived `fieldId` AND
 * `fieldName` — Sitecore resolves recipe-created field GUIDs by name
 * against the SV item's template (the recipe-derived id won't match the
 * tenant's server-assigned field-definition id; the name lookup is what
 * actually writes the value).
 *
 * Reference-shape defaults (link / image / treelist, plus
 * non-enum-backed droplink) are skipped silently — those need encoded
 * GUIDs or structured payloads that the simple `default: "string"`
 * recipe surface can't express. Authors who need defaults for those
 * can layer them in via a `ContentItemRecipe` that targets the SV
 * path explicitly.
 *
 * Enum-shaped fields branch on the resolved Type:
 *   - **Type=Droplist** (override): default is the raw string. Droplist
 *     reads its options from a pipe-separated Source; SV default is a
 *     name match against that list.
 *   - **Type=Droplink + `sitecore.enumHandle`** (the canonical shared
 *     enum shape): default is a `ref-recipe` GUID reference to the
 *     value item under `enumerationFolderId(site, enumHandle)`.
 *   - **Type=Droplink without `sitecore.enumHandle`** (inline Droplink):
 *     unsupported — `resolveFieldSource` rejects it upstream and this
 *     function throws defensively if it ever reaches here.
 *
 * If the declared default isn't actually one of the enum's values, the
 * derived GUID won't exist on the tenant and the SV write fails at
 * apply time — author error, not silently masked here.
 */
/**
 * One non-primary-language `__Standard Values` field version — emitted
 * (via {@link emitStandardValuesLocaleVersions}) as an `AddItemVersion`
 * followed by a versioned `SetField` after the SV `CreateItem`.
 */
export interface StandardValuesLocaleVersion {
  fieldId: string;
  fieldName: string;
  language: string;
  value: RefValue;
}

/**
 * Result of {@link buildStandardValuesFieldEntries}: the primary-language
 * (`en`) field entries that go straight into the SV `CreateItem.fields`,
 * plus any non-primary language versions a locale-map default declared.
 */
export interface StandardValuesBuild {
  primary: FieldValue[];
  localeVersions: StandardValuesLocaleVersion[];
}

// Cohesive SV builder: positional args keep the 30+ call sites terse; an
// options object for the two trailing optionals would be the only thing over
// the limit. Same justification as serialization/api/items.ts.
// eslint-disable-next-line max-params
export function buildStandardValuesFieldEntries(
  site: string,
  handle: string,
  fields: ReadonlyArray<FieldDefinition | DesignParameter>,
  // Resolver for the field-definition refKey. Defaults to `fieldId`
  // (component/content templates); pass `designParameterFieldId` when emitting
  // SV defaults for a parameters template (which uses a different
  // GUID family scoped under `designParametersTemplateId`).
  fieldIdResolver: (site: string, handle: string, fieldName: string) => string = fieldId,
  // When provided, image defaults with external URLs are materialised
  // as media items: a MediaUpload op lands in the sink and the SV entry
  // stores a `media-xml-ref` instead of the legacy `<image src=…>` XML
  // (which Pages/Layout Service never render). The caller must push the
  // sink's mediaOps BEFORE the CreateItem carrying these entries.
  imageMediaSink?: ImageMediaSink,
  // Languages registered on the target environment (Sites API
  // `listLanguages`). When set, locale-map defaults resolve their
  // non-primary versions against it — a template installs SV versions
  // only in the brand's languages and never emits an AddItemVersion for a
  // language the tenant doesn't have (which the Authoring API rejects).
  // A bare base-language key (`de`) fans out to every registered regional
  // variant (`de-DE`, `de-AT`, …); an explicit regional key overrides the
  // base for its exact locale. The primary language is always emitted.
  // Unset ⇒ emit every authored locale verbatim (standalone compile).
  availableLanguages?: readonly string[]
): StandardValuesBuild {
  const primary: FieldValue[] = [];
  const localeVersions: StandardValuesLocaleVersion[] = [];

  for (const field of fields) {
    const rawDefault = field.sitecore?.defaultValue ?? field.default;

    // Locale-map default → one __Standard Values version per language.
    if (rawDefault !== undefined && typeof rawDefault === "object") {
      appendLocalizedStandardValue({
        field,
        localeMap: rawDefault,
        site,
        handle,
        fieldIdResolver,
        imageMediaSink,
        availableLanguages,
        primary,
        localeVersions,
      });
      continue;
    }

    // Plain-string (or absent) default → single primary-language entry.
    let raw = rawDefault;
    if (raw === undefined) {
      // A role-annotated image field with no authored default still
      // gets the brand's image-default when the installer's map covers
      // its role — the role IS the dependency declaration; recipes
      // shouldn't need a throwaway stock URL for substitution to work.
      // The mapped URL feeds the normal encode path, where
      // `externalImageMediaRef` re-applies the same override and
      // materialises the shared site-level media item.
      const role = "role" in field ? field.role : undefined;
      const mapped =
        field.shape === "image" && role !== undefined
          ? imageMediaSink?.imageDefaults?.[role]
          : undefined;
      if (mapped === undefined) continue;
      raw = mapped;
    }
    const value = encodeStandardValueDefaultForField(raw, field, site, handle, imageMediaSink);
    if (value === undefined) continue;
    primary.push({
      fieldId: fieldIdResolver(site, handle, field.name),
      fieldName: field.name,
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value,
    });
  }
  return { primary, localeVersions };
}

/**
 * Expand a locale-map default (`{ en, de, … }`) into a primary-language
 * `__Standard Values` entry plus one non-primary language version per
 * additional (environment-registered) locale.
 *
 * Locale maps only make sense for language-varying copy, so this rejects
 * any non-text/rich-text shape — a GUID reference, image, boolean, or
 * numeric default can't meaningfully differ by language, and silently
 * accepting one would encode the same value N times. The map must carry
 * the primary language (`en`) as its base version.
 *
 * **Base-language expansion.** A map key may be a bare base language
 * (`de`, `zh`) or a full regional code (`de-DE`, `zh-TW`). Against a live
 * environment, keys resolve to the tenant's actual registered languages:
 * a base key fans out to every registered regional variant of that
 * language (`de` → `de-DE`, `de-AT`, …), each carrying the base value,
 * so authors write one translation per language rather than one per
 * region — matching how the dictionary's pre-expanded translations
 * behave, but done in the compiler. An explicit regional key overrides
 * the base expansion for that exact locale (`{ de: "…", "de-CH": "…" }`
 * gives every `de-*` the base copy except `de-CH`). Keys that match no
 * registered language are dropped. With no environment (standalone
 * compile) keys are emitted verbatim.
 */
function appendLocalizedStandardValue(args: {
  field: FieldDefinition | DesignParameter;
  localeMap: Record<string, string>;
  site: string;
  handle: string;
  fieldIdResolver: (site: string, handle: string, fieldName: string) => string;
  imageMediaSink?: ImageMediaSink;
  availableLanguages?: readonly string[];
  primary: FieldValue[];
  localeVersions: StandardValuesLocaleVersion[];
}): void {
  const {
    field,
    localeMap,
    site,
    handle,
    fieldIdResolver,
    imageMediaSink,
    availableLanguages,
    primary,
    localeVersions,
  } = args;

  if (field.shape !== "text" && field.shape !== "richText") {
    throw createScaiError(
      `Field '${field.name}' on recipe '${handle}' declares a per-locale default map but has shape='${field.shape}'. Locale-map defaults are only supported on text / rich-text fields — other shapes (enum, reference, image, boolean, number) can't vary a default by language.`,
      "INPUT_INVALID",
      {
        hint: "Use a plain string `default` for non-text fields, or change the field to shape `text` / `richText`.",
      }
    );
  }

  const primaryRaw = localeMap[DEFAULT_LANGUAGE];
  if (primaryRaw === undefined) {
    throw createScaiError(
      `Field '${field.name}' on recipe '${handle}' declares a per-locale default map without the primary language '${DEFAULT_LANGUAGE}'. The base __Standard Values version is always the primary language, so the map must include it.`,
      "INPUT_INVALID",
      {
        hint: `Add an '${DEFAULT_LANGUAGE}' entry to the default map, e.g. { ${DEFAULT_LANGUAGE}: "…", de: "…" }.`,
      }
    );
  }

  const refKey = fieldIdResolver(site, handle, field.name);

  const primaryValue = encodeStandardValueDefaultForField(
    primaryRaw,
    field,
    site,
    handle,
    imageMediaSink
  );
  if (primaryValue !== undefined) {
    primary.push({
      fieldId: refKey,
      fieldName: field.name,
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value: primaryValue,
    });
  }

  const encodeKey = (key: string): RefValue | undefined =>
    encodeStandardValueDefaultForField(localeMap[key], field, site, handle, imageMediaSink);

  const nonPrimaryKeys = Object.keys(localeMap).filter((k) => k !== DEFAULT_LANGUAGE);

  // Standalone compile (no live environment): emit each authored key
  // verbatim, sorted for deterministic op ordering.
  if (availableLanguages === undefined) {
    for (const key of nonPrimaryKeys.sort()) {
      const value = encodeKey(key);
      if (value === undefined) continue;
      localeVersions.push({ fieldId: refKey, fieldName: field.name, language: key, value });
    }
    return;
  }

  // Resolve authored keys to the environment's actual registered codes.
  // Explicit regional keys win over base-language expansion for their
  // exact locale; `resolved` maps registered-code → value keyed by the
  // registered code's own casing so we emit exactly what the tenant has.
  const resolved = new Map<string, RefValue>();
  const isRegional = (key: string) => /[-_]/.test(key);
  const baseOf = (code: string) => code.split(/[-_]/)[0].toLowerCase();

  // Pass 1 — exact matches (a key equal to a registered code, case-
  // insensitively). Authoritative, so a regional override sticks.
  for (const key of nonPrimaryKeys.sort()) {
    const matches = availableLanguages.filter((l) => l.toLowerCase() === key.toLowerCase());
    if (matches.length === 0) continue;
    const value = encodeKey(key);
    if (value === undefined) continue;
    for (const lang of matches) if (!resolved.has(lang)) resolved.set(lang, value);
  }

  // Pass 2 — base-language expansion: a bare base key fans out to every
  // registered regional variant not already pinned by an exact key.
  for (const key of nonPrimaryKeys.sort()) {
    if (isRegional(key)) continue;
    const matches = availableLanguages.filter((l) => baseOf(l) === key.toLowerCase());
    if (matches.length === 0) continue;
    const value = encodeKey(key);
    if (value === undefined) continue;
    for (const lang of matches) if (!resolved.has(lang)) resolved.set(lang, value);
  }

  const sortedTargets = [...resolved.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [lang, value] of sortedTargets) {
    localeVersions.push({ fieldId: refKey, fieldName: field.name, language: lang, value });
  }
}

/**
 * Emit the non-primary language versions a locale-map default produced.
 * Mirrors the dictionary translation pattern: a `SetField` against a
 * language with no version yet fails with "item … does not contain
 * version #1 in '<locale>'", so each new language gets one
 * `AddItemVersion` before its `SetField`(s). Call AFTER the SV
 * `CreateItem` (which materialises the primary-language version) and its
 * `SetStandardValues` link.
 */
export function emitStandardValuesLocaleVersions(
  operations: Operation[],
  standardValuesRefKey: string,
  localeVersions: readonly StandardValuesLocaleVersion[],
  policy: PushPolicy,
  labelPrefix: string
): void {
  // PHASED: every language's AddItemVersion first, then every SetField.
  // Version stacks for different languages are independent, so the
  // executor's write pool fans the grouped adds out `applyConcurrency`-
  // wide; the old add→set→add→set interleave gated each locale's add on
  // the previous locale's field write (one round-trip at a time — ×9
  // locales on every component's SV item).
  const versionAdds: AddItemVersionOp[] = [];
  const fieldWrites: SetFieldOp[] = [];
  const versioned = new Set<string>();
  for (const lv of localeVersions) {
    if (!versioned.has(lv.language)) {
      versioned.add(lv.language);
      versionAdds.push({
        op: "AddItemVersion",
        policy,
        label: `${labelPrefix}-version:${lv.language}`,
        itemRefKey: standardValuesRefKey,
        language: lv.language,
        version: DEFAULT_VERSION,
      } satisfies AddItemVersionOp);
    }
    fieldWrites.push({
      op: "SetField",
      policy,
      label: `${labelPrefix}-locale:${lv.fieldName}:${lv.language}`,
      itemRefKey: standardValuesRefKey,
      fieldId: lv.fieldId,
      fieldName: lv.fieldName,
      language: lv.language,
      version: DEFAULT_VERSION,
      value: lv.value,
    } satisfies SetFieldOp);
  }
  operations.push(...versionAdds, ...fieldWrites);
}

/**
 * Encode an SV default value for a field. Wraps `encodeStandardValueDefault`
 * with shape-aware handling for enum fields.
 *
 * Type decides the encoding shape:
 *   - Type=Droplink + `sitecore.enumHandle`: default is a GUID reference
 *     to the value item under the EnumerationRecipe's folder
 *     (`enumerationFolderId(site, enumHandle)`).
 *   - Type=Droplist (override): default is the raw string — Droplist's
 *     own enumeration is a pipe-separated Source string, so a name match
 *     in that list is the right encoding.
 *   - Type=Droplink without `enumHandle`: throws INPUT_INVALID — inline
 *     Droplink isn't supported; authors must commit to one of the two
 *     shapes above.
 */
function encodeStandardValueDefaultForField(
  raw: string,
  field: FieldDefinition | DesignParameter,
  site: string,
  handle: string,
  imageMediaSink?: ImageMediaSink
): RefValue | undefined {
  if (field.shape === "enum") {
    const sitecoreType = resolveSitecoreType(field);
    if (sitecoreType === "droplist") {
      // Droplist enumerates from a pipe-list Source; the SV default is
      // the raw value string, not a GUID.
      return { kind: "string", value: raw };
    }
    const enumHandle = field.sitecore?.enumHandle;
    if (!enumHandle) {
      // Defensive — `resolveFieldSource` rejects inline Droplink at the
      // upstream call site, so this branch only fires if an enum field
      // somehow reached SV emission without going through field-op
      // construction. Throw rather than emit a broken default.
      throw createScaiError(
        `Field '${field.name}' on recipe '${handle}' is shape=enum + Type=Droplink but declares no sitecore.enumHandle; inline Droplink isn't supported.`,
        "INPUT_INVALID",
        {
          hint: "Either set `sitecore.enumHandle` to a shared EnumerationRecipe's handle, or override `sitecore.type` to 'droplist' for an inline pipe-list dropdown.",
        }
      );
    }
    return {
      kind: "ref-recipe",
      refKey: enumValueId(enumerationFolderId(site, enumHandle), raw),
    };
  }
  // Reference-shape fields (`shape: "reference"`): the default is one
  // or more recipe handles pointing at content items. Resolve each
  // handle to its deterministic `contentItemId(site, handle)` GUID and
  // emit a `ref-recipe` (single) or `ref-recipe-list` (multi). The
  // executor matches each refKey against the per-run captured-itemId
  // map at apply time. If the referenced handle doesn't materialise as
  // a content item in the same recipe set, the SV write fails at apply
  // time — author error, not silently masked here (same contract as
  // enum defaults above).
  //
  // Convention:
  //   `multiple: false` (Droplink) — single handle string, e.g.
  //     `default: "author-jane@1"`
  //   `multiple: true`  (Treelist / Treelist-with-search) — pipe-
  //     separated handles, e.g. `default: "author-jane@1|author-bob@1"`
  if (field.shape === "reference") {
    // `multiple` lives on FieldDefinition (Treelist) but not on
    // DesignParameter — parameters templates don't model multi-list
    // pickers in scai today. Safe in-check covers both shapes.
    const isMulti = "multiple" in field && field.multiple === true;
    // enumHandle on a reference field = pick from a shared enum's
    // value items. Each pipe-separated token maps to an enum value
    // *name*; resolve to `enumValueId` instead of `contentItemId` so
    // the SV write points at the right value items under the enum
    // folder. Same contract as enum-shape SV defaults — author error
    // (referencing a value that doesn't exist on the enum) fails at
    // apply time with the standard captured-itemId error.
    if (field.sitecore?.enumHandle) {
      const enumFolder = enumerationFolderId(site, field.sitecore.enumHandle);
      const tokens = raw
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (tokens.length === 0) return undefined;
      if (isMulti) {
        return {
          kind: "ref-recipe-list",
          refKeys: tokens.map((t) => enumValueId(enumFolder, t)),
        };
      }
      return { kind: "ref-recipe", refKey: enumValueId(enumFolder, tokens[0]) };
    }
    if (isMulti) {
      const handles = raw
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (handles.length === 0) return undefined;
      return {
        kind: "ref-recipe-list",
        refKeys: handles.map((h) => contentItemId(site, h)),
      };
    }
    const target = raw.trim();
    if (target === "") return undefined;
    return { kind: "ref-recipe", refKey: contentItemId(site, target) };
  }
  return encodeStandardValueDefault(
    raw,
    resolveSitecoreType(field),
    imageMediaSink
      ? {
          site,
          handle,
          fieldName: field.name,
          sink: imageMediaSink,
          // `role` lives on FieldDefinition only (DesignParameter fields
          // don't model images); the in-check covers both union members.
          ...("role" in field && field.role !== undefined ? { role: field.role } : {}),
        }
      : undefined
  );
}

const BOOLEAN_TRUE_PATTERN = /^(1|true|yes|on|enabled)$/i;

function encodeStandardValueDefault(
  raw: string,
  type: SitecoreFieldType,
  imageCtx?: {
    site: string;
    handle: string;
    fieldName: string;
    sink: ImageMediaSink;
    role?: string;
  }
): RefValue | undefined {
  switch (type) {
    case "checkbox":
      // Sitecore stores checkboxes as "1" (true) / "" (false).
      return { kind: "string", value: BOOLEAN_TRUE_PATTERN.test(raw.trim()) ? "1" : "" };
    case "single-line-text":
    case "multi-line-text":
    case "rich-text":
    case "droplist":
    case "lookup":
    case "tags":
    case "number":
    case "integer":
    case "date":
    case "datetime":
      return { kind: "string", value: raw };
    case "general-link": {
      // Convention: pipe-separated `"<text>|<url>"`. Either half may
      // be empty (`"Click|"` → text only, `"|https://x"` → url only).
      // No pipe (`"Just text"`) is treated as text + anchor `#`. The
      // encoded payload is the Sitecore link-field XML format that
      // Standard Values stores natively. This gives recipe authors a
      // way to seed `general-link` SVs so dropped renderings visualise
      // immediately instead of rendering empty button shells.
      const encoded = encodeGeneralLinkDefault(raw);
      if (encoded == null) return undefined;
      return { kind: "string", value: encoded };
    }
    case "image": {
      // Convention: pipe-separated `"<alt>|<src>"`. `<src>` alone (no
      // pipe) seeds a srcless-but-altless default.
      //
      // External-URL defaults (the common case — recipe authors seed
      // picsum/dicebear URLs) are materialised as REAL media items:
      // a MediaUpload op + `media-xml-ref` SV value resolving to
      // `<image mediaid="{GUID}" />`. Bare `src=` XML is stored only
      // when no sink is available (legacy callers) — that form shows a
      // thumbnail in Pages' field editor but never renders on the
      // canvas or in head apps, because the Layout Service only builds
      // a renderable `src` from `mediaid`.
      const parsed = parseAltSrcDefault(raw);
      if (!parsed) return undefined;
      if (imageCtx && isExternalMediaUrl(parsed.src)) {
        return externalImageMediaRef({
          site: imageCtx.site,
          recipeHandle: imageCtx.handle,
          fieldName: imageCtx.fieldName,
          url: parsed.src,
          ...(parsed.alt ? { alt: parsed.alt } : {}),
          ...(imageCtx.role !== undefined ? { role: imageCtx.role } : {}),
          // Standard Values ARE the stock defaults — the one place the
          // brand image-defaults map is meant to substitute.
          substituteRole: true,
          sink: imageCtx.sink,
        });
      }
      const encoded = encodeImageDefault(raw);
      if (encoded == null) return undefined;
      return { kind: "string", value: encoded };
    }
    case "file": {
      // Same `<alt>|<src>` convention as image, but emits the
      // file-field XML (`<file src="…" />`). Layout Service surfaces
      // it as `{ src, ... }` in the file-field value. As with image,
      // no `mediaid` form — recipes don't ship media items, so the
      // external-URL `src` form is what we can express. Authors swap
      // to a real media library item via the file picker.
      const encoded = encodeFileDefault(raw);
      if (encoded == null) return undefined;
      return { kind: "string", value: encoded };
    }
    case "droplink":
    case "treelist":
    case "treelist-with-search":
      // Reference-shape defaults are encoded upstream in
      // `encodeStandardValueDefaultForField` via the recipe-handle
      // resolver (single → `ref-recipe`, multi → `ref-recipe-list`).
      // Reaching this branch means the field declared `shape:
      // "reference"` but the upstream branch didn't fire — defensive
      // skip so a malformed recipe doesn't emit a broken default.
      return undefined;
  }
}

// Sitecore link field stores a small XML payload in the Standard Values
// row. Attributes are XML-escaped. `linktype` mirrors what the platform
// picks based on URL shape — only mailto/anchor warrant special types
// here; relative paths and absolute URLs both use the `external` type
// (Sitecore's runtime renders them the same; the link picker decides
// internal vs external at author-time for items it can resolve).
function encodeGeneralLinkDefault(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const pipeIndex = trimmed.indexOf("|");
  const text = pipeIndex === -1 ? trimmed : trimmed.slice(0, pipeIndex).trim();
  const url = pipeIndex === -1 ? "#" : trimmed.slice(pipeIndex + 1).trim() || "#";
  const linktype = url.startsWith("mailto:")
    ? "mailto"
    : url.startsWith("#")
      ? "anchor"
      : "external";
  const attrs: Array<[string, string]> = [
    ["text", text],
    ["linktype", linktype],
    ["url", url],
  ];
  return `<link ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(" ")} />`;
}

// Sitecore image field stores XML in the Standard Values row. The
// canonical attribute is `mediaid` (a GUID reference into the media
// library) — the ONLY form the Layout Service surfaces as a renderable
// `src`. External-URL defaults are therefore materialised as media
// items via `externalImageMediaRef` (MediaUpload + media-xml-ref); this
// legacy `src=` XML form remains only as the no-sink fallback. Bare
// `src=`/`mediapath=` attributes show a thumbnail in Pages' field
// editor (which reads the raw value) but never render on the canvas or
// the head app. Empty raw returns undefined so the SV entry is skipped.
function encodeImageDefault(raw: string): string | undefined {
  return encodeMediaXmlDefault("image", raw);
}

// Same convention as image (`<alt>|<src>` or bare `<src>`); emits the
// file-field XML form. Authors swap to a media-library item via the
// file picker at placement time; seed src renders in the meantime.
function encodeFileDefault(raw: string): string | undefined {
  return encodeMediaXmlDefault("file", raw);
}

// Parse the pipe-separated `"<alt>|<src>"` media-default convention.
// `<src>` alone (no pipe) yields an empty alt. Empty/whitespace src
// collapses to undefined so callers skip the SV entry entirely.
function parseAltSrcDefault(raw: string): { alt: string; src: string } | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const pipeIndex = trimmed.indexOf("|");
  const alt = pipeIndex === -1 ? "" : trimmed.slice(0, pipeIndex).trim();
  const src = pipeIndex === -1 ? trimmed : trimmed.slice(pipeIndex + 1).trim();
  if (!src) return undefined;
  return { alt, src };
}

// Shared XML body for image + file fields. Sitecore's stored shape
// for both is identical: `<image src="..." alt="..." />` vs
// `<file src="..." alt="..." />`. The element name is the only
// difference.
function encodeMediaXmlDefault(element: "image" | "file", raw: string): string | undefined {
  const parsed = parseAltSrcDefault(raw);
  if (!parsed) return undefined;
  const attrs: Array<[string, string]> = [["src", parsed.src]];
  if (parsed.alt) attrs.push(["alt", parsed.alt]);
  return `<${element} ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(" ")} />`;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
