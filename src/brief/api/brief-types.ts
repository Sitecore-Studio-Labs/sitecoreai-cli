import { createScaiError } from "@/shared/errors";
import { briefRequest } from "./request";
import type { BriefField, BriefType, LocalizedString, PagedResult } from "./schema";
import type { BriefApiClientOptions } from "./types";

/**
 * BriefType resource — catalogue of available brief schemas/templates.
 *
 * Endpoint surface (verified against the Agents env on 2026-05-15 by
 * `scripts/_smoke-brief-types-write.ts`):
 *
 *   GET    /api/brief/v1/brief-types         — list (paged)
 *   GET    /api/brief/v1/brief-types/{id}    — read one
 *   POST   /api/brief/v1/brief-types         — create (201, returns body)
 *   PUT    /api/brief/v1/brief-types/{id}    — update (204, full-replacement)
 *   DELETE /api/brief/v1/brief-types/{id}    — delete (204)
 *
 * Item-level OPTIONS reports `Allow: DELETE, GET, PUT` — no PATCH, so
 * `updateBriefType` performs a full-replacement PUT. Callers wanting
 * field-level merging must read first, mutate, then write.
 *
 * Field definitions on a BriefType carry `aiEditable` and `aiIntent`
 * hints — agents working a brief should respect both.
 */

/** List all brief types. */
export const listBriefTypes = (options: BriefApiClientOptions): Promise<PagedResult<BriefType>> =>
  briefRequest<PagedResult<BriefType>>(options, "/api/brief/v1/brief-types");

/** Read a single brief type by id. */
export const getBriefType = (
  options: BriefApiClientOptions,
  briefTypeId: string
): Promise<BriefType> =>
  briefRequest<BriefType>(options, `/api/brief/v1/brief-types/${encodeURIComponent(briefTypeId)}`);

/**
 * Input for `createBriefType`.
 *
 * `name` must match `^[A-Za-z][A-Za-z0-9_]*$` — the API rejects names
 * starting with non-letters or containing punctuation other than `_`.
 * `label` and `description` are required by the server; the rest are
 * server-defaulted but accepted on input.
 */
export type CreateBriefTypeInput = {
  name: string;
  label: LocalizedString;
  description: string;
  icon: string;
  iconColor: string;
  fields: BriefField[];
};

/**
 * The Brief API requires `name` to match this pattern — a letter first,
 * then letters / digits / underscore. Names starting with a non-letter
 * or carrying other punctuation are rejected server-side.
 */
const BRIEF_TYPE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const BRIEF_TYPE_REQUIRED_KEYS = [
  "name",
  "label",
  "description",
  "icon",
  "iconColor",
  "fields",
] as const;

/**
 * Validate an untyped value against the `CreateBriefTypeInput` contract.
 *
 * Mirrors the Brief API's own input rules so a malformed payload fails
 * fast with a clear message instead of a raw server 400. Throws a
 * `ScaiError` (`INPUT_INVALID`); returns the narrowed input on success.
 * `createBriefType` / `updateBriefType` call this themselves, so direct
 * SDK consumers are guarded without invoking it explicitly.
 */
export const assertCreateBriefTypeInput = (value: unknown): CreateBriefTypeInput => {
  if (!value || typeof value !== "object") {
    throw createScaiError("Brief type body must be a JSON object.", "INPUT_INVALID");
  }
  const obj = value as Record<string, unknown>;
  const missing = BRIEF_TYPE_REQUIRED_KEYS.filter((key) => obj[key] === undefined);
  if (missing.length > 0) {
    throw createScaiError(
      `Brief type body is missing required fields: ${missing.join(", ")}.`,
      "INPUT_INVALID",
      { hint: "Required: name, label, description, icon, iconColor, fields." }
    );
  }
  if (typeof obj.name !== "string" || !BRIEF_TYPE_NAME_PATTERN.test(obj.name)) {
    throw createScaiError(`Invalid 'name': ${JSON.stringify(obj.name)}.`, "INPUT_INVALID", {
      hint: "Server requires name to match /^[A-Za-z][A-Za-z0-9_]*$/.",
    });
  }
  if (!Array.isArray(obj.fields)) {
    throw createScaiError("'fields' must be an array (use [] for none).", "INPUT_INVALID");
  }
  return obj as unknown as CreateBriefTypeInput;
};

/** Create a brief type. Returns the persisted record (201). */
export const createBriefType = (
  options: BriefApiClientOptions,
  input: CreateBriefTypeInput
): Promise<BriefType> => {
  assertCreateBriefTypeInput(input);
  return briefRequest<BriefType>(options, "/api/brief/v1/brief-types", {
    method: "POST",
    body: input,
  });
};

/**
 * Full-replacement update of a brief type (PUT — 204 No Content).
 *
 * `id` in the path is authoritative; any `id` field on the body is
 * ignored by the server. To preserve fields the caller didn't intend
 * to change, fetch with `getBriefType` first, then write the merged
 * result.
 */
export const updateBriefType = (
  options: BriefApiClientOptions,
  briefTypeId: string,
  input: CreateBriefTypeInput
): Promise<void> => {
  assertCreateBriefTypeInput(input);
  return briefRequest<void>(
    options,
    `/api/brief/v1/brief-types/${encodeURIComponent(briefTypeId)}`,
    {
      method: "PUT",
      body: input,
    }
  );
};

/** Delete a brief type. Returns void (204 No Content). */
export const deleteBriefType = (
  options: BriefApiClientOptions,
  briefTypeId: string
): Promise<void> =>
  briefRequest<void>(options, `/api/brief/v1/brief-types/${encodeURIComponent(briefTypeId)}`, {
    method: "DELETE",
  });
