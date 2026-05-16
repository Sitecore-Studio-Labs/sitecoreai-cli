import { requestBrandApi, type BrandApiClientOptions } from "../api/client";
import { BRAND_MANAGEMENT_BASE_PATH } from "../api/types";

export interface BrandKitSummary {
  /** Brand kit UUID. */
  id: string;
  /** Display name. */
  name: string;
  /** Optional internal brand label, often same as `name`. */
  brandName?: string | null;
  /** Optional human description. */
  description?: string | null;
  /** Industry label. */
  industry?: string | null;
  /** Lifecycle state. New kits start `draft`; must be `published` for pipelines. */
  status?: string;
  /** Owning organization. */
  organizationId?: string;
  createdOn?: string;
  createdBy?: string;
  updatedOn?: string;
  updatedBy?: string;
  /** Other fields the server returns; surfaced as-is for callers. */
  [extra: string]: unknown;
}

export interface ListBrandKitsResponse {
  totalCount: number;
  pageSize?: number;
  pageNumber?: number;
  data: BrandKitSummary[];
}

export interface ListBrandKitsOptions {
  client: BrandApiClientOptions;
  /** 1-based page number; defaults to 1. */
  pageNumber?: number;
  /** Items per page; defaults to the server's default (50). */
  pageSize?: number;
  signal?: AbortSignal;
}

/**
 * List brand kits in the active organization. Server-paginated; the
 * defaults (pageNumber=1, pageSize=server-default) cover the common
 * case. Callers expecting many kits should iterate page numbers.
 */
export const listBrandKits = async (
  options: ListBrandKitsOptions
): Promise<ListBrandKitsResponse> => {
  return requestBrandApi<ListBrandKitsResponse>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v1/organizations/${options.client.orgId}/brandkits`,
    method: "GET",
    query: {
      pageNumber: options.pageNumber !== undefined ? String(options.pageNumber) : undefined,
      pageSize: options.pageSize !== undefined ? String(options.pageSize) : undefined,
    },
    signal: options.signal,
  });
};

export interface GetBrandKitOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  signal?: AbortSignal;
}

/**
 * Retrieve a single brand kit by UUID. Returns the same shape as
 * `listBrandKits` entries.
 */
export const getBrandKit = async (options: GetBrandKitOptions): Promise<BrandKitSummary> => {
  return requestBrandApi<BrandKitSummary>(options.client, {
    basePath: BRAND_MANAGEMENT_BASE_PATH,
    path: `/api/brands/v1/organizations/${options.client.orgId}/brandkits/${options.brandKitId}`,
    method: "GET",
    signal: options.signal,
  });
};
