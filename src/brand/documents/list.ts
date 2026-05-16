import { requestBrandApi, type BrandApiClientOptions } from "../api/client";
import { DOCUMENTS_BASE_PATH } from "./upload";

export interface DocumentSummary {
  /** Document UUID. */
  id: string;
  /** Lifecycle: pending | processed | draft | active | archived | edited | failed. */
  status?: string;
  /** Whether the ingestion pipeline has chunked the doc. */
  chunked?: boolean | null;
  /** Whether the enrichment pipeline has summarized the doc. */
  summarized?: boolean | null;
  /** Source URL (Sitecore MMS for uploaded docs). */
  url?: string;
  /** Sitecore MMS file UUID. */
  fileId?: string;
  /** Caller-supplied label (e.g. "brand guidelines"). */
  type?: string | null;
  /** MIME type (e.g. "application/pdf"). */
  fileType?: string;
  /** Server-detected page count. `0` indicates the parser failed. */
  numberOfPages?: number;
  /** Display title. */
  title?: string | null;
  /** Brief description. */
  summary?: string;
  /** Tags (auto-extracted by enrichment, e.g. section names). */
  tags?: string[];
  /** Brand kit binding. */
  brandkitId?: string;
  /** Reference back-links. */
  references?: Array<{ id: string; path: string; type: string }>;
  createdOn?: string;
  createdBy?: string;
  updatedOn?: string;
  updatedBy?: string;
  [extra: string]: unknown;
}

export interface ListDocumentsResponse {
  totalCount: number;
  pageSize?: number;
  pageNumber?: number;
  data: DocumentSummary[];
}

export interface ListDocumentsOptions {
  client: BrandApiClientOptions;
  /** Filter to documents bound to this kit. */
  brandKitId?: string;
  /** Filter by status (e.g. `"processed"`, `"failed"`). */
  status?: string;
  /** Pagination. */
  pageNumber?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

/**
 * List documents in the org, optionally filtered by brand kit and/or
 * status. Paginated. The `data[i].status` field is the most useful
 * filter for finding broken uploads.
 */
export const listDocuments = async (
  options: ListDocumentsOptions
): Promise<ListDocumentsResponse> => {
  return requestBrandApi<ListDocumentsResponse>(options.client, {
    basePath: DOCUMENTS_BASE_PATH,
    path: `/api/documents/v2/organizations/${options.client.orgId}/documents`,
    method: "GET",
    query: {
      brandkitId: options.brandKitId,
      status: options.status,
      pageNumber: options.pageNumber !== undefined ? String(options.pageNumber) : undefined,
      pageSize: options.pageSize !== undefined ? String(options.pageSize) : undefined,
    },
    signal: options.signal,
  });
};

export interface GetDocumentOptions {
  client: BrandApiClientOptions;
  documentId: string;
  signal?: AbortSignal;
}

/**
 * Retrieve a single document by UUID. Useful for polling pipeline
 * progress — `chunked` / `summarized` / `status` update as the
 * server-side AI processes the file.
 */
export const getDocument = async (options: GetDocumentOptions): Promise<DocumentSummary> => {
  return requestBrandApi<DocumentSummary>(options.client, {
    basePath: DOCUMENTS_BASE_PATH,
    path: `/api/documents/v2/organizations/${options.client.orgId}/documents/${options.documentId}`,
    method: "GET",
    signal: options.signal,
  });
};

export interface DeleteDocumentOptions {
  client: BrandApiClientOptions;
  documentId: string;
  signal?: AbortSignal;
}

/**
 * Delete a document. Per the OpenAPI, the DELETE endpoint lives on
 * v1 (not v2): `DELETE /api/documents/v1/.../documents/{id}` returns
 * `204`.
 */
export const deleteDocument = async (options: DeleteDocumentOptions): Promise<void> => {
  await requestBrandApi<void>(options.client, {
    basePath: DOCUMENTS_BASE_PATH,
    path: `/api/documents/v1/organizations/${options.client.orgId}/documents/${options.documentId}`,
    method: "DELETE",
    signal: options.signal,
  });
};
