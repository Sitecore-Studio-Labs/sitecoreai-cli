import { campaignRequest } from "./request";
import type { Project } from "./schema";
import type { CampaignApiClientOptions } from "./types";

/**
 * Attachments resource — files referenced on a campaign (project).
 *
 * Endpoint surface (HAR-derived from the Content Operations UI):
 *   POST   /api/orchestrate/v1/projects/{projectId}/attachments/{fileId}  — attach (200)
 *   DELETE /api/orchestrate/v1/projects/{projectId}/attachments/{fileId}  — detach
 *
 * An attachment references an MMS file by its `fileId` (the **mediaId** —
 * the last path segment of the file's `mms-delivery` URL, NOT the
 * doc-service file id), plus the file's metadata. The Content Ops UI
 * fetches the bytes from MMS by this id to render the attachment, so the
 * id must be backed by real MMS bytes for the attachment to display.
 *
 * Producing such an id requires the MMS upload flow, which needs the
 * `mms.upload.file:add` scope — not carried by scai's M2M credentials.
 * These functions are the wiring: given a real MMS mediaId (from an
 * upload done where that scope exists, e.g. an interactive user session),
 * they attach/detach it on a campaign. See `attachProjectAttachment`.
 */

/** Metadata stored alongside an attachment. Mirrors `ProjectAttachment.metadata`. */
export type AttachmentMetadata = {
  mimeType: string;
  fileName: string;
  /** File size in bytes, as a string (the wire shape). */
  contentLength: string;
};

/**
 * Attach an MMS file to a campaign as a resource.
 *
 * `fileId` is the MMS **mediaId** — the trailing segment of the file's
 * `mms-delivery` URL. Returns the updated project (with the attachment in
 * `project.attachments`). Verified live: the attachment is stored; whether
 * it *renders* depends on the id being backed by real MMS bytes.
 */
export const attachProjectAttachment = (
  options: CampaignApiClientOptions,
  projectId: string,
  fileId: string,
  metadata: AttachmentMetadata
): Promise<Project> =>
  campaignRequest<Project>(
    options,
    `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}` +
      `/attachments/${encodeURIComponent(fileId)}`,
    { method: "POST", body: { metadata } }
  );

/**
 * Detach a file from a campaign. Returns void — a 204 is expected.
 */
export const deleteProjectAttachment = (
  options: CampaignApiClientOptions,
  projectId: string,
  fileId: string
): Promise<void> =>
  campaignRequest<void>(
    options,
    `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}` +
      `/attachments/${encodeURIComponent(fileId)}`,
    { method: "DELETE" }
  );
