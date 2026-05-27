/**
 * Version-level field read/write helpers for the Authoring GraphQL
 * surface.
 *
 * Used by `scai content version *` and `scai content publish unpublish` to
 * read/write the three publish-state fields Sitecore exposes per
 * version:
 *
 *   - `__Never publish` (boolean — stored as "1" / "")
 *   - `__Valid from`    (datetime — ISO 8601 string)
 *   - `__Valid to`      (datetime — ISO 8601 string)
 *
 * Distinct from `src/recipe/api/authoring-client.ts:updateItem` for
 * two reasons:
 *
 *   1. Recipe pushes write **item-level** fields (no version/language
 *      qualifier on the mutation input) — fine for shared fields and
 *      "the only version" usage, but never targets a specific version.
 *      The publish-state fields are versioned, so the mutation needs
 *      `language` and `version` on the input.
 *   2. Recipe pushes go through `dispatchMutation` with rollback,
 *      retries, and idempotent-create fallback. The content-state
 *      verbs are explicit single-version writes with audit-log gating;
 *      they don't want the recipe push path's behavior.
 *
 * Mutation shape verified against the Authoring GraphQL schema
 * (XM Cloud, 2026-05-14) — `UpdateItemInput` accepts `language` /
 * `version` alongside `itemId` and `fields`, and the version-scoped
 * write only touches the targeted version.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import { runAuthoringGraphQL, type AuthoringRequestOptions } from "@/authoring";
import { createScaiError } from "@/shared/errors";

/**
 * Sitecore boolean fields are stored as a string: `"1"` for true and
 * an empty string for false. This is the wire form `updateItem`
 * accepts and `getItem` returns. Anyone consuming `__Never publish`
 * from a remote read should canonicalize via {@link parseBoolean}.
 */
export const SITECORE_BOOLEAN_TRUE = "1";
export const SITECORE_BOOLEAN_FALSE = "";

export const FIELD_NEVER_PUBLISH = "__Never publish";
export const FIELD_VALID_FROM = "__Valid from";
export const FIELD_VALID_TO = "__Valid to";

/**
 * The set of publish-state fields scai reads/writes per version. Kept
 * as a tuple so the type system can narrow on field names elsewhere.
 */
export const PUBLISH_STATE_FIELDS = [
  FIELD_NEVER_PUBLISH,
  FIELD_VALID_FROM,
  FIELD_VALID_TO,
] as const;

export type PublishStateFieldName = (typeof PUBLISH_STATE_FIELDS)[number];

const READ_QUERY = `
query($itemId: ID!, $language: String!, $version: Int) {
  item(where: { itemId: $itemId }) {
    itemId
    name
    path
    version(language: $language, version: $version) {
      version
      language { name }
      fields(ownFields: false) {
        nodes {
          name
          value
        }
      }
    }
  }
}`;

const UPDATE_MUTATION = `
mutation($itemId: ID!, $language: String!, $version: Int!, $fields: [FieldValueInput!]!) {
  updateItem(input: {
    itemId: $itemId
    language: $language
    version: $version
    fields: $fields
  }) {
    item { itemId }
  }
}`;

export interface VersionFieldValue {
  name: string;
  value: string;
}

export interface VersionFieldsSnapshot {
  itemId: string;
  name: string;
  path: string;
  language: string;
  /** Sitecore-assigned version number (1-indexed). */
  version: number;
  /** Every field on the version, keyed by display name. Includes both
   *  versioned and shared fields — caller is responsible for filtering
   *  to the publish-state subset if that's all it needs. */
  fields: VersionFieldValue[];
}

/**
 * Parse Sitecore's wire form for booleans. Returns:
 *   - `true`  for "1"
 *   - `false` for "" or "0" or undefined
 *   - the raw value's truthiness for anything else (defensive)
 */
export const parseBoolean = (raw: string | undefined | null): boolean => {
  if (raw === SITECORE_BOOLEAN_TRUE) return true;
  if (raw === SITECORE_BOOLEAN_FALSE || raw == null || raw === "0") return false;
  return Boolean(raw);
};

/**
 * Format a boolean for the wire ("1" / "").
 */
export const formatBoolean = (value: boolean): string =>
  value ? SITECORE_BOOLEAN_TRUE : SITECORE_BOOLEAN_FALSE;

/**
 * Look up a single field on a snapshot. Returns the stored value or
 * `null` when the field isn't present on the version (Sitecore treats
 * absent versioned fields as effectively empty; we surface that
 * distinction to the audit trail as `null` so an operator can tell
 * apart "was explicitly empty" from "wasn't there at all").
 */
export const findField = (snapshot: VersionFieldsSnapshot, name: string): string | null => {
  const match = snapshot.fields.find((f) => f.name === name);
  return match ? match.value : null;
};

export interface ReadVersionFieldsOptions {
  itemId: string;
  language: string;
  /** Specific version (1-indexed). Undefined → latest. */
  version?: number;
  request?: AuthoringRequestOptions;
}

interface ReadResponse {
  item: {
    itemId: string;
    name: string;
    path: string;
    version: {
      version: number;
      language: { name: string };
      fields: { nodes: Array<{ name: string; value: string }> };
    } | null;
  } | null;
}

/**
 * Read the version-state fields for `(itemId, language, version?)`.
 * Throws `INPUT_INVALID` if the item or the requested version doesn't
 * exist — the caller is responsible for path → itemId resolution
 * before invoking this helper (use the existing
 * `resolveItemPathsToIds`).
 */
export const readVersionFields = async (
  environment: EnvironmentConfiguration,
  options: ReadVersionFieldsOptions
): Promise<VersionFieldsSnapshot> => {
  const data = await runAuthoringGraphQL<ReadResponse>(
    environment,
    READ_QUERY,
    {
      itemId: options.itemId,
      language: options.language,
      version: options.version ?? null,
    },
    options.request
  );
  if (!data.item) {
    throw createScaiError(
      `Item '${options.itemId}' not found in env content tree.`,
      "INPUT_INVALID",
      {
        hint: "Verify the itemId is correct and the authenticated client has read access.",
      }
    );
  }
  if (!data.item.version) {
    throw createScaiError(
      `Item '${options.itemId}' has no version for language '${options.language}'${
        options.version !== undefined ? ` (version ${options.version})` : ""
      }.`,
      "INPUT_INVALID",
      {
        hint: "Pass a different --language, or omit --version to target the latest. Operators creating a fresh version need to do so via the Sitecore Authoring UI first.",
      }
    );
  }
  return {
    itemId: data.item.itemId,
    name: data.item.name,
    path: data.item.path,
    language: data.item.version.language.name,
    version: data.item.version.version,
    fields: data.item.version.fields.nodes.map((node) => ({
      name: node.name,
      value: node.value,
    })),
  };
};

export interface WriteVersionFieldsOptions {
  itemId: string;
  language: string;
  /** Required — the specific version to write. Use `readVersionFields`
   *  first to resolve "latest" → a concrete number, then pass it back
   *  here so the write is unambiguous if a new version is created
   *  between read and write. */
  version: number;
  fields: VersionFieldValue[];
  request?: AuthoringRequestOptions;
}

/**
 * Write `fields` to the version at `(itemId, language, version)`.
 *
 * Disables retries — the Authoring GraphQL endpoint has no
 * idempotency-key mechanism, so retrying a write that already
 * succeeded server-side would double-apply. Same reasoning the recipe
 * runtime uses for `writeRequest` (see `authoring-client.ts`).
 */
export const writeVersionFields = async (
  environment: EnvironmentConfiguration,
  options: WriteVersionFieldsOptions
): Promise<void> => {
  if (options.fields.length === 0) {
    return;
  }
  await runAuthoringGraphQL(
    environment,
    UPDATE_MUTATION,
    {
      itemId: options.itemId,
      language: options.language,
      version: options.version,
      fields: options.fields.map((f) => ({ name: f.name, value: f.value })),
    },
    {
      ...(options.request ?? {}),
      retry: { maxAttempts: 1, ...(options.request?.retry ?? {}) },
    }
  );
};

/**
 * Resolve a content-tree path to its itemId via the Authoring API.
 * Single-path convenience around the read query — the publishing
 * surface's `resolveItemPathsToIds` is batched + multi-path; for the
 * `content version *` verbs (one item at a time) the single-path
 * shape is clearer.
 *
 * Returns the canonical itemId without curly braces.
 */
export const resolveSinglePathToId = async (
  environment: EnvironmentConfiguration,
  path: string,
  request?: AuthoringRequestOptions
): Promise<string> => {
  const data = await runAuthoringGraphQL<{ item: { itemId: string } | null }>(
    environment,
    `query($path: String!) { item(where: { path: $path }) { itemId } }`,
    { path },
    request
  );
  if (!data.item?.itemId) {
    throw createScaiError(`Path '${path}' did not resolve to an item.`, "INPUT_INVALID", {
      hint: "Verify the path exists in the env's content tree and the authenticated client has read access.",
    });
  }
  return data.item.itemId;
};
