import { createScaiError } from "@/shared/errors";
import { contentItemId, fieldId, templateId } from "../guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type RefValue,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../policy";
import {
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import {
  type ContentFieldValue,
  type ContentItemRecipe,
  ContentItemRecipeSchema,
} from "../schema/recipe";
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `ContentItemRecipe` to an Operation IR.
 *
 * Emits one `CreateItem` for the content item plus one `SetField` per
 * field value. The item's `templateOf` resolves via `templateId(templateType)`
 * — the corresponding `ContentTemplateRecipe` (or `ComponentTemplateRecipe`)
 * must ship in the same set so the executor's captured-itemId map carries
 * its server-assigned GUID at apply time. The cross-recipe validator
 * (`validateRecipeSet`) catches missing template references before push.
 *
 * Field values dispatch on `shape` to one of the encoders below. Most
 * shapes encode at compile time to a `kind: "string"` value (Sitecore's
 * stored representation is always a string); `reference` shapes emit
 * `kind: "ref-recipe-list"` so the executor substitutes captured itemIds
 * at apply time.
 *
 * Phase 4 v1 limitations:
 *  - `link-internal` is deferred — the wire format is XML wrapping a
 *    refKey-resolved GUID, which requires a new RefValue kind. Authors
 *    should use `reference` (with a single-element `refs` array) for
 *    Droplink/Reference fields, or `link-external` for external URLs.
 *  - `image.mediaPath` is treated as an opaque path — no media-item
 *    upload. Sitecore renders the field if a media library item exists
 *    at that path; otherwise the field is empty until media seeding
 *    lands in Phase 5+.
 */
export function compileContentItemRecipe(
  input: ContentItemRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ContentItemRecipeSchema.parse(input);
  if (!context.contentItemsRoot) {
    throw createScaiError(
      `compileContentItemRecipe requires context.contentItemsRoot; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID"
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const itemRefKey = contentItemId(site, recipe.handle);
  const itemPath = joinPath(context.contentItemsRoot, recipe.name);
  const templateRefKey = templateId(site, recipe.templateType);

  operations.push({
    op: "CreateItem",
    policy,
    label: `content-item:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.contentItemsRoot },
    // String GUID — the executor treats this as a refKey when it matches a
    // captured-itemId entry (the ContentTemplateRecipe / ComponentTemplateRecipe
    // for `recipe.templateType` registers `templateId(handle)` at apply
    // time), else as a literal Sitecore template GUID.
    templateOf: templateRefKey,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  for (const [fieldName, fieldValue] of Object.entries(recipe.fields)) {
    const value = encodeContentFieldValue(fieldValue, recipe.handle, site);
    if (value === null) continue;
    const fieldGuid = fieldId(site, recipe.templateType, fieldName);
    operations.push({
      op: "SetField",
      policy,
      label: `content-item-field:${recipe.handle}:${fieldName}`,
      itemRefKey,
      fieldId: fieldGuid,
      // Recipe-created field — Sitecore assigns its own GUID to the
      // Template Field item, so fieldGuid is only an IR-internal refKey.
      // The mutation needs the human-readable name; planner uses it for
      // diff matching against the remote item's field-by-name.
      fieldName,
      // Versioned: content-item field values are language/version-scoped.
      // Default language/version are filled in by versionedField helper —
      // duplicating its shape here so the SetField op carries them.
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value,
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Format a recipe `date` (ISO `YYYY-MM-DD`) or `datetime` (ISO 8601 with
 * timezone) into Sitecore's stored format `yyyyMMddTHHmmssZ`.
 */
const toSitecoreDate = (iso: string, kind: "date" | "datetime"): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw createScaiError(
      `ContentFieldValue ${kind}: '${iso}' is not a valid ISO date`,
      "INPUT_INVALID"
    );
  }
  if (kind === "date") {
    // Date-only — pin to UTC midnight to keep the output deterministic
    // regardless of host timezone.
    const isoDateOnly = iso.includes("T") ? iso.slice(0, 10) : iso;
    return `${isoDateOnly.replace(/-/g, "")}T000000Z`;
  }
  // Datetime: yyyyMMddTHHmmssZ in UTC.
  const yyyy = parsed.getUTCFullYear().toString().padStart(4, "0");
  const MM = (parsed.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = parsed.getUTCDate().toString().padStart(2, "0");
  const HH = parsed.getUTCHours().toString().padStart(2, "0");
  const mm = parsed.getUTCMinutes().toString().padStart(2, "0");
  const ss = parsed.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${MM}${dd}T${HH}${mm}${ss}Z`;
};

/**
 * Sitecore image-field XML. Phase 4 v1 emits `mediapath` only — see
 * `compileContentItemRecipe` JSDoc for the media-item upload caveat.
 */
const encodeImageXml = (img: {
  mediaPath: string;
  alt?: string;
  width?: number;
  height?: number;
}): string => {
  const attrs: string[] = [`mediapath="${escapeXmlAttr(img.mediaPath)}"`];
  if (img.alt !== undefined) attrs.push(`alt="${escapeXmlAttr(img.alt)}"`);
  if (img.width !== undefined) attrs.push(`width="${img.width}"`);
  if (img.height !== undefined) attrs.push(`height="${img.height}"`);
  return `<image ${attrs.join(" ")} />`;
};

/**
 * Sitecore General Link XML for an external URL (`linktype="external"`).
 */
const encodeExternalLinkXml = (link: {
  href: string;
  text?: string;
  target?: string;
  title?: string;
}): string => {
  const attrs: string[] = [`linktype="external"`, `url="${escapeXmlAttr(link.href)}"`];
  if (link.text !== undefined) attrs.push(`text="${escapeXmlAttr(link.text)}"`);
  if (link.target !== undefined) attrs.push(`target="${escapeXmlAttr(link.target)}"`);
  if (link.title !== undefined) attrs.push(`title="${escapeXmlAttr(link.title)}"`);
  return `<link ${attrs.join(" ")} />`;
};

const escapeXmlAttr = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Encode one ContentFieldValue to a RefValue. Returns null when the
 * shape is deferred (e.g. `link-internal` in Phase 4 v1) — the caller
 * skips emitting a SetField op for it. Throws on truly invalid input.
 */
const encodeContentFieldValue = (
  value: ContentFieldValue,
  recipeHandle: string,
  site: string
): RefValue | null => {
  switch (value.shape) {
    case "text":
    case "richText":
    case "enum":
      return { kind: "string", value: value.value };
    case "boolean":
      return { kind: "bool", value: value.value };
    case "number":
    case "integer":
      return { kind: "number", value: value.value };
    case "date":
    case "datetime":
      return { kind: "string", value: toSitecoreDate(value.value, value.shape) };
    case "image":
      return { kind: "string", value: encodeImageXml(value) };
    case "link-external":
      return { kind: "string", value: encodeExternalLinkXml(value) };
    case "link-internal":
      // Deferred: General Link XML wrapping a refKey-resolved GUID needs
      // a new RefValue kind. Recipe authors targeting Phase 4 should use
      // `reference` (single-element refs[]) for Droplink-shaped fields.
      throw createScaiError(
        `ContentItemRecipe '${recipeHandle}': link-internal is deferred to Phase 5. ` +
          `Use 'reference' shape with a single-element refs[] for Droplink/Reference fields, ` +
          `or 'link-external' with an absolute URL for now.`,
        "INPUT_INVALID"
      );
    case "reference":
      return {
        kind: "ref-recipe-list",
        refKeys: value.refs.map((handle) => contentItemId(site, handle)),
      };
  }
};
