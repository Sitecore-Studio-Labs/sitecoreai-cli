/**
 * Bootstrap the `Scai Handle` marker field — the one-time, per-environment
 * setup that makes recipe identity work (see `marker.ts` and
 * docs/recipe-sync-architecture.md, "Recipe identity — the marker field").
 *
 * `injectHandleMarker` (push) and the planner's marker-match both assume the
 * `Scai Handle` field *exists* on the tenant. It does not, on a fresh
 * environment. This module adds it: a single shared string field on the
 * Sitecore **Standard Template**, so every item — template, section, field,
 * enumeration, content — inherits it uniformly.
 *
 * The field lives under a scai-owned `Scai` section (a direct-child Template
 * Section of the Standard Template) parked at a high sort order, so it sits
 * out of an author's way: it is scai-managed metadata, not authored content.
 *
 * `ensureMarkerField` is idempotent — running it on an environment that
 * already has the field is a no-op read. The bootstrap is also expressible
 * as a content-template recipe; this imperative form is what `scai`'s setup
 * path calls before the first recipe push.
 *
 * Caveat (verify on a live XM Cloud tenant): adding a field to the built-in
 * Standard Template, and the field-visibility setting that keeps it out of
 * the content editor — both are flagged unverified in the architecture doc.
 */
import { createScaiError } from "@/shared/errors";
import type { AuthoringApiClient } from "./api/client";
import type { FieldValue } from "./ir/operations";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "./ir/sitecore-templates";
import { sitecoreFieldTypeLabel } from "./schema/field-types";
import { SCAI_HANDLE_FIELD_NAME } from "./marker";

/** Name of the scai-owned Template Section the marker field lives under. */
export const SCAI_SECTION_NAME = "Scai";

/**
 * Sort order for the `Scai` section and the `Scai Handle` field. A high
 * value parks both at the bottom of the content editor — the marker is
 * scai-managed metadata, not something an author should reach for.
 */
const SCAI_MARKER_SORT_ORDER = 9999;

/**
 * Compare two Sitecore GUIDs ignoring case, curly braces, AND hyphens.
 * The Authoring API returns GUIDs hyphen-less (`1930bbeb7805471a…`) while
 * the built-in constants are hyphenated — a brace/case-only compare misses.
 */
const sameGuid = (a: string, b: string): boolean => {
  const norm = (g: string): string => g.trim().toLowerCase().replace(/[{}-]/g, "");
  return norm(a) === norm(b);
};

/**
 * The field definition written onto the `Scai Handle` Template Field item:
 * a shared Single-Line Text field, high sort order, with `Title` /
 * `__Display name` set so the CMS labels it sensibly. `Shared = "1"` because
 * the marker is per-item identity — it must not vary by language or version.
 */
const markerFieldDefinition = (): FieldValue[] => [
  {
    fieldId: TEMPLATE_FIELD_FIELDS.TYPE,
    value: { kind: "string", value: sitecoreFieldTypeLabel("single-line-text") },
  },
  {
    fieldId: SYSTEM_FIELDS.SORT_ORDER,
    value: { kind: "number", value: SCAI_MARKER_SORT_ORDER },
  },
  {
    fieldId: TEMPLATE_FIELD_FIELDS.SHARED,
    value: { kind: "string", value: "1" },
  },
  {
    fieldId: TEMPLATE_FIELD_FIELDS.TITLE,
    language: DEFAULT_LANGUAGE,
    version: DEFAULT_VERSION,
    value: { kind: "string", value: SCAI_HANDLE_FIELD_NAME },
  },
  {
    fieldId: SYSTEM_FIELDS.DISPLAY_NAME,
    language: DEFAULT_LANGUAGE,
    version: DEFAULT_VERSION,
    value: { kind: "string", value: SCAI_HANDLE_FIELD_NAME },
  },
];

/** Outcome of {@link ensureMarkerField}. */
export interface EnsureMarkerFieldResult {
  /** `"created"` when this call added the field; `"already-present"` when it was found. */
  status: "created" | "already-present";
  /** itemId of the `Scai Handle` Template Field item. */
  fieldItemId: string;
  /** itemId of the Template Section the field lives under. */
  sectionItemId: string;
}

/**
 * Ensure the `Scai Handle` marker field exists on the Standard Template.
 *
 * Idempotent: scans every Template Section directly under the Standard
 * Template for an existing `Scai Handle` field and returns it untouched when
 * found (even if a prior bootstrap placed it under a differently-named
 * section). Otherwise it ensures the `Scai` section and creates the field.
 *
 * Throws `INPUT_INVALID` when the Standard Template can't be resolved — the
 * environment isn't pointed at an XM Cloud authoring endpoint, or the
 * authoring database lacks the built-in template.
 */
export const ensureMarkerField = async (
  client: AuthoringApiClient
): Promise<EnsureMarkerFieldResult> => {
  const standardTemplate = await client.getItem({ itemId: STANDARD_TEMPLATE_ID });
  if (!standardTemplate) {
    throw createScaiError(
      "Could not resolve the Sitecore Standard Template — the `Scai Handle` marker field cannot be bootstrapped.",
      "INPUT_INVALID",
      {
        hint: `Expected the built-in Standard Template (${STANDARD_TEMPLATE_ID}) in the authoring 'master' database. Verify the environment points at an XM Cloud authoring endpoint.`,
      }
    );
  }

  // Direct-child Template Sections of the Standard Template. A
  // previously-bootstrapped marker field lives under one of them.
  const sections = (await client.getChildren({ itemId: standardTemplate.itemId })).filter(
    (child) => sameGuid(child.templateId, SITECORE_TEMPLATES.TEMPLATE_SECTION)
  );

  for (const section of sections) {
    const fields = await client.getChildren({ itemId: section.itemId });
    const existing = fields.find(
      (f) =>
        sameGuid(f.templateId, SITECORE_TEMPLATES.TEMPLATE_FIELD) &&
        f.name.toLowerCase() === SCAI_HANDLE_FIELD_NAME.toLowerCase()
    );
    if (existing) {
      return {
        status: "already-present",
        fieldItemId: existing.itemId,
        sectionItemId: section.itemId,
      };
    }
  }

  // Not present — reuse the `Scai` section if it already exists, else create
  // it, then create the field under it.
  const existingScaiSection = sections.find(
    (s) => s.name.toLowerCase() === SCAI_SECTION_NAME.toLowerCase()
  );
  const sectionItemId =
    existingScaiSection?.itemId ??
    (
      await client.createItem({
        parent: standardTemplate.itemId,
        templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
        name: SCAI_SECTION_NAME,
        fields: [
          {
            fieldId: SYSTEM_FIELDS.SORT_ORDER,
            value: { kind: "number", value: SCAI_MARKER_SORT_ORDER },
          },
        ],
        idempotencyCheck: true,
      })
    ).itemId;

  const field = await client.createItem({
    parent: sectionItemId,
    templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
    name: SCAI_HANDLE_FIELD_NAME,
    fields: markerFieldDefinition(),
    idempotencyCheck: true,
  });

  return { status: "created", fieldItemId: field.itemId, sectionItemId };
};
