/**
 * Sitecore built-in template GUIDs that recipe-emitted items conform to.
 *
 * Sourced from `plans/sitecore-relationships.md` (orchestrator repo) — the
 * inventory document built from the xmcloud-starter-js Button bundle.
 * These are baked into Sitecore and are stable across tenants.
 *
 * Format: lowercase hex with hyphens, no curly braces. The reference
 * encoding (`{...}` curly form vs bare) is decided per-field at the IR
 * executor layer.
 */

export const SITECORE_TEMPLATES = {
  /** Item conforms to this when it *is* a data template. */
  TEMPLATE: "ab86861a-6030-46c5-b394-e8f99e8b87db",
  /** Item conforms to this when it is a section within a template. */
  TEMPLATE_SECTION: "e269fbb5-3750-427a-9149-7aa950b49301",
  /** Item conforms to this when it is a field within a section. */
  TEMPLATE_FIELD: "455a3e98-a627-4b40-8035-e683a0331ac7",
  /**
   * Item conforms to this when it is a rendering. The relationship inventory
   * groups View Rendering and JSON Rendering under one ID; differentiation
   * may be needed in later phases for headless-only tenants.
   */
  RENDERING: "04646a89-996f-4ee7-878a-ffdbf1f0ef0d",
  /**
   * Sitecore Folder template. Used in Phase 1 Variants Lite for both the
   * `<Rendering>/Variants` folder and each Variant item — bare items, no
   * SXA-specific structure. Phase 2+ should switch to the SXA Variant
   * Definition template once the GUID is sandbox-validated.
   */
  FOLDER: "a87a00b1-e6db-45ab-8b54-636fec3b5523",
} as const;

/**
 * Sitecore Standard Template — the implicit base of every template that
 * doesn't declare its own `__Base template`.
 */
export const STANDARD_TEMPLATE_ID = "1930bbeb-7805-471a-a3be-4858ac7cf696";

/**
 * Stable system-field GUIDs that recipes need to write.
 * Auto-generated metadata fields (__Created, __Updated, __Revision, __Owner)
 * are deliberately omitted — Sitecore writes those.
 */
export const SYSTEM_FIELDS = {
  ICON: "06d5295c-ed2f-4a54-9bf2-26228d113318",
  BASE_TEMPLATE: "12c33f3f-86c5-43a5-aeb4-5598cec45116",
  STANDARD_VALUES: "f7d48a55-2158-4f02-9356-756654404f73",
  SORT_ORDER: "ba3f86a2-4a1c-4d78-b63d-91c2779c1b5e",
  DISPLAY_NAME: "b5e02ad9-d56f-4c41-a065-a133db87bdeb",
  /**
   * `__Masters` — the field that backs the CMS "Insert Options" UI.
   * Set on the standard-values item to a pipe-separated list of allowed
   * child template GUIDs. GUID verified against sandbox tenant
   * (`xmc-lizsitecore088b-...`) on 2026-04-30 via Authoring API
   * `templateField.templateFieldId` introspection.
   */
  INSERT_OPTIONS: "1172f251-dad4-4efb-a329-0c63500e4f1e",
} as const;

/** Field-definition shared fields on a Template Field item. */
export const TEMPLATE_FIELD_FIELDS = {
  TYPE: "ab162cc0-dc80-4abf-8871-998ee5d7ba32",
  SOURCE: "1eb8ae32-e190-44a6-968d-ed904c794ebf",
  TITLE: "19a69332-a23e-4e70-8d16-b2640cb24cc8",
} as const;

/** Rendering-definition shared fields on a Rendering item. */
export const RENDERING_FIELDS = {
  COMPONENT_NAME: "037fe404-dd19-4bf7-8e30-4dadf68b27b0",
  DATASOURCE_TEMPLATE: "1a7c85e5-dc0b-490d-9187-bb1dbcb4c72f",
  DATASOURCE_LOCATION: "b5b27af1-25ef-405c-87ce-369b3a004016",
  PARAMETERS_TEMPLATE: "a77e8568-1ab3-44f1-a664-b7c37ec7810d",
  OPEN_PROPERTIES_AFTER_ADD: "7d8ae35f-9ed1-43b5-96a2-0a5f040d4e4e",
  OTHER_PROPERTIES: "e829c217-5e94-4306-9c48-2634b094fdc2",
} as const;

export const DEFAULT_LANGUAGE = "en";
export const DEFAULT_VERSION = 1;
export const DEFAULT_ICON = "Office/32x32/document.png";
