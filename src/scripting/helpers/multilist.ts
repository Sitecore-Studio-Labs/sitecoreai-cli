import { createScaiError } from "@/shared/errors";
import type { ScaiClient } from "../connect";

/**
 * Multilist field utilities — composable helpers for the
 * pipe-delimited GUID lists Sitecore uses for Multilist / Treelist /
 * Droplink-list fields. CLI `cleanup find-replace` is regex-shaped and
 * can't safely target a single GUID inside a delimited list (escape and
 * trailing-pipe edge cases bite). These helpers parse the field, mutate
 * the parsed form, and write the rejoined value back.
 *
 * Safe-by-default: every mutator takes `allowWrite: boolean`. When
 * false (the default), the helper returns the diff without making the
 * Authoring API call. Callers wire their own consent — script authors
 * decide when to flip the flag.
 */

const GUID_DELIMITER = "|";

const normalizeGuid = (raw: string): string => raw.replace(/[{}]/g, "").trim().toLowerCase();

const parseMultilist = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(GUID_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const formatMultilist = (entries: string[]): string => entries.join(GUID_DELIMITER);

export interface RemoveRefArgs {
  itemId: string;
  fieldName: string;
  /** GUID to remove. Matched case-insensitively, with or without braces. */
  refToRemove: string;
  /** When false (default), no mutation is made — returns the diff only. */
  allowWrite?: boolean;
}

export interface RemoveRefResult {
  changed: boolean;
  before: string;
  after: string;
  /** True when the helper made the wire call. False on dry-run or no-op. */
  applied: boolean;
}

/**
 * Remove a specific GUID from a multilist-shaped field on a single
 * item. The match is case-insensitive and brace-tolerant — both
 * `{ABC...}` and `abc...` shapes resolve to the same entry.
 *
 * Returns `changed: true` when the GUID was present in the field
 * (regardless of `allowWrite`). `applied: true` only when the
 * mutation actually reached the Authoring API.
 */
export const removeRef = async (
  client: ScaiClient,
  args: RemoveRefArgs
): Promise<RemoveRefResult> => {
  if (!args.itemId) {
    throw createScaiError("removeRef requires itemId.", "INPUT_INVALID");
  }
  if (!args.fieldName) {
    throw createScaiError("removeRef requires fieldName.", "INPUT_INVALID");
  }
  if (!args.refToRemove) {
    throw createScaiError("removeRef requires refToRemove.", "INPUT_INVALID");
  }

  const fields = await client.hygiene.getItemFields({ itemId: args.itemId });
  if (!fields) {
    throw createScaiError(`Item ${args.itemId} not found.`, "INPUT_INVALID");
  }
  const field = fields.find((f) => f.name === args.fieldName);
  if (!field) {
    throw createScaiError(
      `Field '${args.fieldName}' not found on item ${args.itemId}.`,
      "INPUT_INVALID",
      {
        hint: `Available fields: ${fields.map((f) => f.name).join(", ")}.`,
      }
    );
  }

  const before = field.value ?? "";
  const target = normalizeGuid(args.refToRemove);
  const entries = parseMultilist(before);
  const filtered = entries.filter((entry) => normalizeGuid(entry) !== target);
  const after = formatMultilist(filtered);

  if (after === before) {
    return { changed: false, before, after, applied: false };
  }

  if (!args.allowWrite) {
    return { changed: true, before, after, applied: false };
  }

  await client.hygiene.updateItemFields({
    itemId: args.itemId,
    fields: [{ name: args.fieldName, value: after }],
  });

  return { changed: true, before, after, applied: true };
};
