import { createScaiError } from "@/shared/errors";
import { clearBrandToken } from "@/shared/keychain";
import { acquireBrandToken } from "../api/auth";
import { BRAND_API_HOST } from "../api/types";
import type { BrandApiClientOptions } from "../api/client";

/**
 * Base path for the Brand Documents API. Same edge host as the
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

export type UploadDocumentSource =
  | { kind: "url"; url: string }
  | { kind: "bytes"; bytes: Buffer | Uint8Array; mimeType?: string };

/**
 * Why local-file (`bytes`) upload is rejected. The documents API
 * offers two routes for a local file and neither works:
 *
 *   - The documented v2 `multipart/form-data` `file` part is
 *     server-broken — the parser drops the sibling `create_request`
 *     part whenever a `file` part is present and returns
 *     `400 create_request: Field required`.
 *   - A `data:<mime>;base64,…` value in the `url` field is accepted
 *     at POST time (201) but the server never fetches it, so the doc
 *     stays at `numberOfPages: 0` and never processes.
 *
 * Both reproduced empirically against the Agents tenant 2026-05-15
 * (`scripts/_smoke-brand-upload-modes.ts`). Until Sitecore exposes a
 * working local-upload path, callers must host the file and use URL
 * mode.
 */
export const LOCAL_UPLOAD_UNSUPPORTED_MESSAGE =
  "Local-file document upload is not supported — the Sitecore documents API has no working path for it.";

export const LOCAL_UPLOAD_UNSUPPORTED_HINT =
  "Host the PDF at an HTTPS URL that Sitecore's edge can reach (S3, GitHub raw, a CDN), then upload it by URL — `--url <pdfUrl>` on the CLI, or the `url` field on the MCP tool.";

export interface UploadDocumentOptions {
  client: BrandApiClientOptions;
  /** Brand kit UUID to attach the document to. */
  brandKitId: string;
  /**
   * Source of the document. Only URL mode works:
   *
   *   - `{ kind: "url", url }` — Sitecore fetches the file from the
   *     URL and copies it into MMS. The URL must be an HTTP(S)
   *     address reachable from Sitecore's edge.
   *   - `{ kind: "bytes", … }` — local-file upload. **Not supported**
   *     — `uploadDocument` rejects it with `INPUT_INVALID`. See
   *     {@link LOCAL_UPLOAD_UNSUPPORTED_MESSAGE} for why.
   *
   * The string form `{ url }` is shorthand for `{ kind: "url", url }`.
   */
  source: UploadDocumentSource | { url: string };
  /** Document type tag, e.g. "brand guidelines". */
  type?: string;
  /**
   * Document MIME type, e.g. "application/pdf". The working Sync kit
   * docs use the full MIME (not labels like "PDF").
   */
  fileType?: string;
  /** Display title; if `setMetadata: true` the server may overwrite. */
  title?: string;
  /** Brief description. */
  summary?: string;
  /** Tags. The server rejects null — defaults to []. */
  tags?: string[];
  /**
   * Whether the server should auto-fill metadata (page count, etc.)
   * from the fetched file. Defaults to true.
   */
  setMetadata?: boolean;
  signal?: AbortSignal;
}

export interface UploadedDocument {
  id: string;
  organizationId?: string;
  status?: string;
  /** Sitecore MMS URL the file got copied to (when copying happens). */
  url?: string;
  fileId?: string;
  type?: string;
  fileType?: string;
  brandkitId?: string;
  references?: Array<{ id: string; path: string; type: string }>;
  [extra: string]: unknown;
}

const buildReferencePath = (orgId: string, brandKitId: string): string =>
  `/api/brands/v1/organizations/${orgId}/brandkits/${brandKitId}/references`;

/**
 * Upload a brand document to the Sitecore Brand Documents API and
 * attach it to a specific brand kit.
 *
 * **URL mode only.** The server fetches the file from `url` and copies
 * it to Sitecore MMS asynchronously, so the `url` must be an HTTP(S)
 * address reachable from Sitecore's edge. Local-file (`bytes`) uploads
 * are rejected up front — see {@link LOCAL_UPLOAD_UNSUPPORTED_MESSAGE}.
 *
 * **Wire shape:** v2 endpoint, `application/x-www-form-urlencoded`, a
 * single `create_request` form parameter whose value is a JSON string
 * carrying `url`, `tags`, `references`, and metadata fields. The
 * documented `multipart/form-data` `file` part is server-broken; the
 * form-urlencoded path is what returns 201 with references populated.
 */
export const uploadDocument = async (options: UploadDocumentOptions): Promise<UploadedDocument> => {
  const source =
    "kind" in options.source ? options.source : ({ kind: "url", url: options.source.url } as const);
  if (source.kind === "bytes") {
    throw createScaiError(LOCAL_UPLOAD_UNSUPPORTED_MESSAGE, "INPUT_INVALID", {
      hint: LOCAL_UPLOAD_UNSUPPORTED_HINT,
    });
  }

  const host = options.client.host ?? BRAND_API_HOST;
  const url = new URL(
    `${DOCUMENTS_BASE_PATH}/api/documents/v2/organizations/${options.client.orgId}/documents`,
    host
  ).toString();

  const createRequestJson = JSON.stringify({
    url: source.url,
    setMetadata: options.setMetadata ?? true,
    type: options.type ?? "brand guidelines",
    fileType: options.fileType ?? "application/pdf",
    title: options.title,
    summary: options.summary,
    tags: options.tags ?? [],
    references: [
      {
        type: "brandkit",
        id: options.brandKitId,
        path: buildReferencePath(options.client.orgId, options.brandKitId),
      },
    ],
  });

  const fire = async (token: string): Promise<Response> => {
    const body = new URLSearchParams();
    body.set("create_request", createRequestJson);
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: options.signal,
    });
  };

  let token = await acquireBrandToken({
    orgId: options.client.orgId,
    credential: options.client.credential,
  });
  let response = await fire(token);

  if (response.status === 401) {
    await clearBrandToken(options.client.orgId);
    token = await acquireBrandToken({
      orgId: options.client.orgId,
      credential: options.client.credential,
    });
    response = await fire(token);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw createScaiError(
      `Document upload failed (${response.status}): ${detail || "Unknown error"}`,
      "BRAND_API_FAILED"
    );
  }
  return (await response.json()) as UploadedDocument;
};
