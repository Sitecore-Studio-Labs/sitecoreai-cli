import { requestBrandApi, type BrandApiClientOptions } from "../api/client";

/**
 * Base path for the AI Skills Documents API. Same edge host as the
 * Brand Management / Brand Review APIs.
 */
export const DOCUMENTS_BASE_PATH = "/stream/ai-document-api";

export interface DocumentUploadReference {
  /** Reference type — always `"brandkit"` for kit-bound docs. */
  type: "brandkit";
  /** UUID of the target brand kit. */
  id: string;
  /** Canonical brand kit references path. */
  path: string;
}

export interface UploadDocumentOptions {
  client: BrandApiClientOptions;
  /** Brand kit UUID to attach the document to. */
  brandKitId: string;
  /**
   * Publicly-reachable URL to a PDF (or other supported file type)
   * the Sitecore edge can download. Sitecore re-fetches the URL and
   * stores the file in MMS — direct local-file upload requires the
   * MMS API (out of scope until concrete demand).
   */
  url: string;
  /** Document type tag, e.g. "brand guidelines". */
  type?: string;
  /** Document MIME / file type tag, e.g. "PDF". */
  fileType?: string;
  /** Display title; if `setMetadata: true` the server may overwrite. */
  title?: string;
  /** Brief description. */
  summary?: string;
  /** Tags. The server rejects null/missing — defaults to []. */
  tags?: string[];
  /**
   * Whether the server should auto-fill metadata (page count, etc.)
   * from the fetched file. Defaults to true.
   */
  setMetadata?: boolean;
  /**
   * Section IDs in the brand kit to associate the document with.
   * Defaults to [] — server requires the field but accepts empty.
   */
  sectionIds?: string[];
  signal?: AbortSignal;
}

export interface UploadedDocument {
  id: string;
  organizationId?: string;
  status?: string;
  /** Sitecore MMS URL the file got copied to. */
  url?: string;
  fileId?: string;
  type?: string;
  fileType?: string;
  brandkitId?: string;
  [extra: string]: unknown;
}

const buildReferencePath = (orgId: string, brandKitId: string): string =>
  `/api/brands/v1/organizations/${orgId}/brandkits/${brandKitId}/references`;

/**
 * Upload a brand document to the Sitecore AI Skills Documents API and
 * attach it to a specific brand kit.
 *
 * **API quirk:** the OpenAPI spec documents a v2 multipart endpoint
 * (`POST /api/documents/v2/.../documents`), but it consistently 400s
 * with `'create_request' field required` regardless of how the
 * multipart body is encoded — verified empirically 2026-05-14 with
 * both hand-rolled multipart and curl's native `-F`. The v1 endpoint
 * (`POST /api/documents/v1/.../documents`) IS the working surface
 * and takes a JSON body that includes `brandkitId`, `sections`,
 * `url`, `tags`, `references`, and metadata fields.
 *
 * The v1 endpoint downloads from `url` to Sitecore MMS — scai does
 * NOT upload the file directly. Callers must host the PDF at a URL
 * the Sitecore edge can reach. Local-file upload (via MMS) is a
 * follow-up; for now this is the developer-supplied-URL path.
 */
export const uploadDocument = async (
  options: UploadDocumentOptions
): Promise<UploadedDocument> => {
  const body = {
    brandkitId: options.brandKitId,
    sections: options.sectionIds ?? [],
    url: options.url,
    type: options.type ?? "brand guidelines",
    fileType: options.fileType ?? "PDF",
    title: options.title,
    summary: options.summary,
    tags: options.tags ?? [],
    setMetadata: options.setMetadata ?? true,
    references: [
      {
        type: "brandkit",
        id: options.brandKitId,
        path: buildReferencePath(options.client.orgId, options.brandKitId),
      },
    ],
  };

  return requestBrandApi<UploadedDocument>(options.client, {
    basePath: DOCUMENTS_BASE_PATH,
    path: `/api/documents/v1/organizations/${options.client.orgId}/documents`,
    method: "POST",
    body,
    signal: options.signal,
  });
};
