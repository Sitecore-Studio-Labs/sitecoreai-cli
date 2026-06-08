import { requestBrandApi, type BrandApiClientOptions } from "../api/client";
import { BRAND_MANAGEMENT_BASE_PATH } from "../api/types";

/**
 * Brand kit subsection (field) type, as returned by the API.
 *   - `text` → free-form string value
 *   - `array` → list of `{ name }` entries (bulleted lists, dos/don'ts,
 *     checklist items, palette swatches)
 *   - `richArray` → list of `{ name, tags[], restrictions }` entries
 *     (tone scenarios, image-style scenarios — context-tagged guidance)
 */
export type BrandKitFieldType = "text" | "array" | "richArray";

export interface BrandKitArrayEntry {
  /** The entry's text. Required. */
  name: string;
  /** Server-assigned UUID. Omit when writing — the server fills it in. */
  id?: string;
}

export interface BrandKitRichArrayEntry extends BrandKitArrayEntry {
  /** Free-form tags ("Marketing", "Claims", "Self-Serve", …). */
  tags?: string[];
  /** Per-scenario constraints ("Never use scarcity in marketing copy"). */
  restrictions?: string;
}

/**
 * Value shape varies by `BrandKitFieldType`. Callers writing values
 * must match the field's type — the server rejects mismatches with
 * a 422 validation error. Inspect with `listBrandKitFields` first if
 * you're unsure.
 */
export type BrandKitFieldValue = string | BrandKitArrayEntry[] | BrandKitRichArrayEntry[];

export interface BrandKitSectionSummary {
  /** Section UUID. */
  id: string;
  /** Display name (e.g. "Brand Context", "Tone of Voice"). */
  name: string;
  /** Sort order returned by the server. */
  order?: number;
  /** Whether the section can be deleted (predefined sections are not). */
  deletable?: boolean;
  createdOn?: string;
  createdBy?: string;
  updatedOn?: string;
  updatedBy?: string;
  deletedAt?: string | null;
  properties?: unknown;
  [extra: string]: unknown;
}

export interface BrandKitFieldSummary {
  /** Field UUID. */
  id: string;
  /** Display name of the subsection. */
  name: string;
  /** Field type — `"text"`, `"array"`, or `"richArray"`. */
  type?: BrandKitFieldType;
  /** Sort order within the section. */
  order?: number;
  /**
   * Content value populated by enrichment or operator edits.
   *
   * Shape depends on `type`:
   *   - `text` → string
   *   - `array` → `{ name: string; id?: string }[]`
   *   - `richArray` → `{ name: string; tags?: string[]; restrictions?: string; id?: string }[]`
   *
   * Empty until the kit's EnrichSectionsPipeline runs, or until a
   * direct PATCH via `updateBrandKitField` writes a value.
   */
  value?: BrandKitFieldValue;
  /** AI-facing description of what this field is for. */
  intent?: string;
  /** Whether the AI Sections enrichment pipeline may overwrite this. */
  aiEditable?: boolean;
  /** Whether the field can be deleted. Predefined fields are not. */
  deletable?: boolean;
  /** Verification state (null = not verified). */
  verified?: boolean | null;
  /** Field-level references, often empty. */
  references?: unknown[];
  createdOn?: string;
  createdBy?: string;
  updatedOn?: string;
  updatedBy?: string;
  properties?: unknown;
  [extra: string]: unknown;
}

export interface ListBrandKitSectionsOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  signal?: AbortSignal;
}

/**
 * List sections of a brand kit, with names and IDs.
 *
 * **Note:** the endpoint returns a bare JSON array (not the
 * paginated `{ data, totalCount }` envelope `listBrandKits` uses).
 * Verified empirically 2026-05-14.
 *
 * Sections are predefined per kit (Brand Context, Global Goals,
 * Tone of Voice, Glossary and Localization, plus a few others
 * created during enrichment). They only appear after the kit's
 * `EnrichSectionsPipeline` has populated them — a freshly-created
 * kit returns an empty array.
 */
export const listBrandKitSections = async (
  options: ListBrandKitSectionsOptions
): Promise<BrandKitSectionSummary[]> => {
  return requestBrandApi<BrandKitSectionSummary[]>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v1/organizations/${options.client.orgId}/brandkits/${options.brandKitId}/sections`,
    method: "GET",
    signal: options.signal,
  });
};

export interface ListBrandKitFieldsOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  sectionId: string;
  signal?: AbortSignal;
}

/**
 * List subsections (fields) of a section. Like sections, returns a
 * bare array. Field `value` is empty until enrichment has run; the
 * `intent` describes what the field is supposed to capture.
 */
export const listBrandKitFields = async (
  options: ListBrandKitFieldsOptions
): Promise<BrandKitFieldSummary[]> => {
  return requestBrandApi<BrandKitFieldSummary[]>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v2/organizations/${options.client.orgId}/brandkits/${options.brandKitId}/sections/${options.sectionId}/fields`,
    method: "GET",
    signal: options.signal,
  });
};

export interface UpdateBrandKitFieldOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  sectionId: string;
  fieldId: string;
  /**
   * Content value. Shape must match the field's `type` — text for
   * `text` fields, `BrandKitArrayEntry[]` for `array`,
   * `BrandKitRichArrayEntry[]` for `richArray`. Omit to leave the
   * value unchanged.
   */
  value?: BrandKitFieldValue;
  /** Update the AI-facing intent string. Rarely set by operators. */
  intent?: string;
  /** Mark the field's content as operator-verified. */
  verified?: boolean;
  /** Whether the enrichment pipeline may overwrite this field. */
  aiEditable?: boolean;
  /** Reorder within the section. */
  order?: number;
  /** Rename the subsection. Only operator-created sections support this. */
  name?: string;
  signal?: AbortSignal;
}

/**
 * Partially update a brand kit subsection (field). The reliable path
 * for populating kits whose source PDF didn't survive Sitecore's AI
 * ingestion pipeline — see `scai://help/brand-kit-generation` for
 * when to prefer this over the seed-from-PDF flow.
 *
 * Wraps `PATCH /api/brands/v2/.../sections/{sectionId}/fields/{fieldId}`.
 *
 * Behavioural notes verified empirically:
 *   - Only the keys present in the request body are touched; others
 *     are left alone (true partial update).
 *   - Server rejects `value` shape that doesn't match the field's
 *     `type` (e.g. string for an `array` field) with HTTP 422.
 *   - Returns the updated field with server-assigned `id`s on any
 *     newly-added array entries.
 */
export const updateBrandKitField = async (
  options: UpdateBrandKitFieldOptions
): Promise<BrandKitFieldSummary> => {
  const body: Record<string, unknown> = {};
  if (options.value !== undefined) body.value = options.value;
  if (options.intent !== undefined) body.intent = options.intent;
  if (options.verified !== undefined) body.verified = options.verified;
  if (options.aiEditable !== undefined) body.aiEditable = options.aiEditable;
  if (options.order !== undefined) body.order = options.order;
  if (options.name !== undefined) body.name = options.name;

  return requestBrandApi<BrandKitFieldSummary>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v2/organizations/${options.client.orgId}/brandkits/${options.brandKitId}/sections/${options.sectionId}/fields/${options.fieldId}`,
    method: "PATCH",
    body,
    signal: options.signal,
  });
};

export interface CreateBrandKitSectionFieldOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  sectionId: string;
  /** Field (subsection) name. For Glossary this is the term itself. */
  name: string;
  /** Field type — must match the `value` shape. */
  type: BrandKitFieldType;
  /** Initial content. Shape must match `type` (string / object-array). */
  value?: BrandKitFieldValue;
  intent?: string;
  order?: number;
  signal?: AbortSignal;
}

/**
 * Create a new subsection (field) inside a brand kit section.
 *
 * Wraps `POST /api/brands/v2/.../sections/{sectionId}/fields`
 * (`create_brand_kit_section_field`). Needed because some fields are
 * never produced by the enrichment pipeline — notably Glossary &
 * Localization terms, where each term IS a field. Without a create
 * call those terms can't exist; `updateBrandKitField` only patches
 * fields that already resolve to an id.
 */
export const createBrandKitSectionField = async (
  options: CreateBrandKitSectionFieldOptions
): Promise<BrandKitFieldSummary> => {
  const body: Record<string, unknown> = { name: options.name, type: options.type };
  if (options.value !== undefined) body.value = options.value;
  if (options.intent !== undefined) body.intent = options.intent;
  if (options.order !== undefined) body.order = options.order;

  return requestBrandApi<BrandKitFieldSummary>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v2/organizations/${options.client.orgId}/brandkits/${options.brandKitId}/sections/${options.sectionId}/fields`,
    method: "POST",
    body,
    signal: options.signal,
  });
};
