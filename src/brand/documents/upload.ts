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

export interface DocumentCreateMetadata {
  /** If the document is hosted elsewhere, the URL it lives at. */
  url?: string;
  /** Whether the server should auto-fill metadata fields (title, page count, …). */
  setMetadata?: boolean;
  status?: "pending" | "processed" | "draft" | "active" | "archived" | "edited" | "failed";
  type?: string;
  fileType?: string;
  size?: string;
  numberOfPages?: number;
  pageRangeFrom?: number;
  pageRangeTo?: number;
  title?: string;
  summary?: string;
  tags?: string[];
  references?: DocumentUploadReference[];
}

export interface UploadDocumentOptions {
  client: BrandApiClientOptions;
  /** Brand kit UUID to attach the document to. */
  brandKitId: string;
  /** PDF bytes to upload. The API only accepts PDFs. */
  pdf: Buffer | Uint8Array;
  /** Filename the multipart part will use; influences the server's metadata. */
  fileName: string;
  /** Extra metadata merged into the `create_request` JSON. */
  metadata?: Partial<DocumentCreateMetadata>;
  signal?: AbortSignal;
}

export interface UploadedDocument {
  id: string;
  status?: string;
  url?: string;
  organizationId?: string;
  [extra: string]: unknown;
}

const buildReferencePath = (orgId: string, brandKitId: string): string =>
  `/api/brands/v1/organizations/${orgId}/brandkits/${brandKitId}/references`;

const buildCreateRequest = (
  orgId: string,
  brandKitId: string,
  metadata: Partial<DocumentCreateMetadata> = {}
): string => {
  const merged: DocumentCreateMetadata = {
    setMetadata: true,
    ...metadata,
    references: [
      {
        type: "brandkit",
        id: brandKitId,
        path: buildReferencePath(orgId, brandKitId),
      },
      ...(metadata.references ?? []),
    ],
  };
  return JSON.stringify(merged);
};

/**
 * Upload a brand document to the Sitecore AI Skills Documents API and
 * attach it to a specific brand kit. The API takes `multipart/form-data`
 * with two parts:
 *
 *   - `file`: the PDF bytes (binary).
 *   - `create_request`: a JSON string containing metadata + the
 *     brand-kit reference link. scai builds the reference path
 *     automatically; callers supply only the `brandKitId` and the
 *     metadata fields they care about.
 *
 * On 401 the cached AI Skills token is cleared and the request is
 * retried once with a fresh mint — matches the `requestBrandApi`
 * 401-once-retry pattern.
 *
 * Returns the created document's id + status. Documents start in
 * `pending` and reach `processed` after the Pipeline run; callers
 * waiting for ingestion should poll the brand kit's sections list
 * rather than the document status (the Pipeline API has no `GET run`
 * status endpoint as of 2026-05-14).
 */
export const uploadDocument = async (
  options: UploadDocumentOptions
): Promise<UploadedDocument> => {
  const host = options.client.host ?? AI_SKILLS_API_HOST;
  const url = new URL(
    `${DOCUMENTS_BASE_PATH}/api/documents/v2/organizations/${options.client.orgId}/documents`,
    host
  ).toString();

  const createRequestJson = buildCreateRequest(
    options.client.orgId,
    options.brandKitId,
    options.metadata
  );

  const fire = async (token: string): Promise<Response> => {
    // Hand-roll the multipart body. Node's built-in `FormData` should
    // work with `fetch`, but the Sitecore FastAPI parser intermittently
    // rejects the encoding with `'create_request' field required`
    // even when it's present — verified 2026-05-14. Constructing the
    // wire payload directly avoids any browser/Node FormData
    // differences and gives us a predictable Content-Type boundary.
    // Boundary must NOT start with `-` — the wire delimiter prepends
    // `--` to the value, and parsers sometimes choke on `------` runs.
    const boundary = `scaiBoundary${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    const enc = (s: string): Buffer => Buffer.from(s, "utf8");
    const CRLF = "\r\n";

    const parts: Buffer[] = [];
    // create_request part — plain form-data text field. FastAPI's
    // `Form(...)` parameter binding expects fields with no per-part
    // Content-Type; setting one routes the part as a different model
    // and leaves `create_request` "missing".
    parts.push(enc(`--${boundary}${CRLF}`));
    parts.push(enc(`Content-Disposition: form-data; name="create_request"${CRLF}${CRLF}`));
    parts.push(enc(createRequestJson));
    parts.push(enc(CRLF));
    // file part — application/pdf binary
    parts.push(enc(`--${boundary}${CRLF}`));
    parts.push(
      enc(
        `Content-Disposition: form-data; name="file"; filename="${options.fileName}"${CRLF}`
      )
    );
    parts.push(enc(`Content-Type: application/pdf${CRLF}${CRLF}`));
    parts.push(Buffer.isBuffer(options.pdf) ? options.pdf : Buffer.from(options.pdf));
    parts.push(enc(CRLF));
    // closing boundary
    parts.push(enc(`--${boundary}--${CRLF}`));

    const body = Buffer.concat(parts);

    // Debug: when SCAI_BRAND_DEBUG_MULTIPART is set, dump the raw
    // request body so we can inspect what the wire actually carries.
    if (process.env.SCAI_BRAND_DEBUG_MULTIPART) {
      const debugPath = `/tmp/scai-brand-upload-${Date.now()}.bin`;
      const { writeFileSync } = await import("node:fs");
      writeFileSync(debugPath, body);
      process.stderr.write(`> [debug] wrote multipart body to ${debugPath} (${body.length} bytes)\n`);
      process.stderr.write(`> [debug] Content-Type: multipart/form-data; boundary=${boundary}\n`);
    }

    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length.toString(),
      },
      body,
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
