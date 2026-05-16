import { requestBrandApi, type BrandApiClientOptions } from "../api/client";
import { BRAND_MANAGEMENT_BASE_PATH } from "../api/types";
import type { BrandKitSummary } from "./list";

export interface CreateBrandKitOptions {
  client: BrandApiClientOptions;
  /** Display name; required. */
  name: string;
  /** Optional human description. */
  description?: string;
  /** Industry label (free-form, e.g. "retail", "developer-tools"). */
  industry?: string;
  /** Internal brand name (often same as `name`). */
  brandName?: string;
  /** Company name if different from brand. */
  companyName?: string;
  /** Logo URL — must be a PNG per the OpenAPI. */
  logo?: string;
  signal?: AbortSignal;
}

/**
 * Create a new brand kit. New kits land in `status: "draft"` and must
 * be PATCHed to `published` via `publishBrandKit` before either of
 * the ingestion pipelines will populate sections — see
 * [[project-scai-brand-kit-seed-recipe]] for the full sequence.
 *
 * Returns the created kit's summary record with its UUID.
 */
export const createBrandKit = async (options: CreateBrandKitOptions): Promise<BrandKitSummary> => {
  return requestBrandApi<BrandKitSummary>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v1/organizations/${options.client.orgId}/brandkits`,
    method: "POST",
    body: {
      name: options.name,
      brandName: options.brandName ?? options.name,
      description: options.description,
      industry: options.industry,
      companyName: options.companyName,
      logo: options.logo,
    },
    signal: options.signal,
  });
};

export interface PublishBrandKitOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  signal?: AbortSignal;
}

/**
 * Flip a brand kit's `status` to `"published"`. Required before the
 * brand ingestion / enrichment pipelines will populate the kit's
 * sections — leaving a kit in `draft` causes the pipelines to chunk
 * the source documents but never produce section content (the
 * symptom: doc `summarized` stays `null` and the kit's section list
 * stays empty indefinitely).
 *
 * Idempotent: PATCHing an already-published kit returns 200 with the
 * same status.
 */
export const publishBrandKit = async (
  options: PublishBrandKitOptions
): Promise<BrandKitSummary> => {
  return requestBrandApi<BrandKitSummary>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v1/organizations/${options.client.orgId}/brandkits/${options.brandKitId}`,
    method: "PATCH",
    body: { status: "published" },
    signal: options.signal,
  });
};

export interface DeleteBrandKitOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  signal?: AbortSignal;
}

/**
 * Delete a brand kit. The endpoint is undocumented in Sitecore's
 * OpenAPI but the portal UI uses it and it works
 * (`DELETE /api/brands/v1/.../brandkits/{id}` returns `204`).
 *
 * Caveat: this DOES NOT delete the kit's attached documents. Use
 * `deleteDocument` for cleanup of dangling docs.
 */
export const deleteBrandKit = async (options: DeleteBrandKitOptions): Promise<void> => {
  await requestBrandApi<void>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v1/organizations/${options.client.orgId}/brandkits/${options.brandKitId}`,
    method: "DELETE",
    signal: options.signal,
  });
};
