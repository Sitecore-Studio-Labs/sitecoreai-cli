import { createScaiError } from "@/shared/errors";
import { clearAiSkillsToken } from "@/shared/keychain";
import { acquireAiSkillsToken } from "../api/auth";
import { AI_SKILLS_API_HOST } from "../api/types";
import type { BrandApiClientOptions } from "../api/client";

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
   * Publicly-reachable URL to the document the Sitecore edge can
   * download. Today, scai only supports URL-based uploads — the
   * v2 `multipart/form-data` endpoint with a `file` binary part is
   * broken on Sitecore's side (the FastAPI parser drops the
   * `create_request` field whenever a `file` part is included).
   * Local-file upload waits on a Sitecore fix or a separate MMS
   * upload API.
   */
  url: string;
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
 * Upload a brand document to the Sitecore AI Skills Documents API and
 * attach it to a specific brand kit.
 *
 * **Wire shape:** v2 endpoint, `application/x-www-form-urlencoded`,
 * a single `create_request` form parameter whose value is a
 * URL-encoded JSON string carrying `url`, `tags`, `references`, and
 * metadata fields. Verified empirically 2026-05-14:
 *   - The documented `multipart/form-data` shape with `file` (binary)
 *     + `create_request` (JSON string) does NOT work — the server's
 *     FastAPI parser drops `create_request` whenever a `file` part
 *     is present. Reproduced with Node FormData, hand-rolled
 *     multipart, and curl's native `-F` form handling.
 *   - The form-urlencoded path with `create_request` alone is what
 *     actually accepts the request and returns 201.
 *   - References populate on this path; the alternative undocumented
 *     v1 JSON path leaves references empty.
 *
 * The server fetches the file from `url` and copies it to Sitecore
 * MMS asynchronously. Local-file upload requires the multipart `file`
 * part to be fixed server-side OR a separate MMS direct-upload API.
 */
export const uploadDocument = async (
  options: UploadDocumentOptions
): Promise<UploadedDocument> => {
  const host = options.client.host ?? AI_SKILLS_API_HOST;
  const url = new URL(
    `${DOCUMENTS_BASE_PATH}/api/documents/v2/organizations/${options.client.orgId}/documents`,
    host
  ).toString();

  const createRequestJson = JSON.stringify({
    url: options.url,
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

  let token = await acquireAiSkillsToken({
    orgId: options.client.orgId,
    credential: options.client.credential,
  });
  let response = await fire(token);

  if (response.status === 401) {
    await clearAiSkillsToken(options.client.orgId);
    token = await acquireAiSkillsToken({
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
