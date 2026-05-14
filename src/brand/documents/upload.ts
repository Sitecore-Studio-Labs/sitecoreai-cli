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

export type UploadDocumentSource =
  | { kind: "url"; url: string }
  | { kind: "bytes"; bytes: Buffer | Uint8Array; mimeType?: string };

export interface UploadDocumentOptions {
  client: BrandApiClientOptions;
  /** Brand kit UUID to attach the document to. */
  brandKitId: string;
  /**
   * Source of the document bytes. Two modes:
   *
   *   - `{ kind: "url", url }` — Sitecore fetches the file from the
   *     URL and copies into MMS. URL must be reachable from
   *     Sitecore's edge.
   *   - `{ kind: "bytes", bytes, mimeType }` — local file. scai
   *     base64-encodes the bytes and sends as `data:<mime>;base64,…`
   *     in the `url` field. The v2 multipart `file` part is
   *     server-broken (FastAPI parser drops `create_request`
   *     whenever a `file` part is present), so the data-URL path is
   *     the only working route for local uploads.
   *
   * The string form `{ url }` is shorthand for `{ kind: "url", url }`
   * — preserves the previous callable shape.
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
export const uploadDocument = async (options: UploadDocumentOptions): Promise<UploadedDocument> => {
  const host = options.client.host ?? AI_SKILLS_API_HOST;
  const url = new URL(
    `${DOCUMENTS_BASE_PATH}/api/documents/v2/organizations/${options.client.orgId}/documents`,
    host
  ).toString();

  const source =
    "kind" in options.source ? options.source : ({ kind: "url", url: options.source.url } as const);
  const resolvedUrl =
    source.kind === "url"
      ? source.url
      : (() => {
          const mime = source.mimeType ?? "application/pdf";
          const buf = Buffer.isBuffer(source.bytes) ? source.bytes : Buffer.from(source.bytes);
          return `data:${mime};base64,${buf.toString("base64")}`;
        })();

  const createRequestJson = JSON.stringify({
    url: resolvedUrl,
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
