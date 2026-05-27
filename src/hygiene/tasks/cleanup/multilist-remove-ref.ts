/**
 * Remove a single GUID from a multilist-shaped field on a single item.
 *
 * scai's bulk `cleanup field-set --mode remove` handles the scoped /
 * cross-item case; this verb is the single-item primitive — the
 * "I have one item and one GUID to unlink" operation. Promoted from
 * the `scripting/helpers/multilist.ts` `removeRef` helper so it's
 * usable without a script entry point (which agents and ad-hoc
 * operators don't reach for).
 */

import { createScaiError } from "@/shared/errors";
import { type HygieneCommonOptions, ensureAllowWrite, resolveTenant, toLogger } from "../shared";

const GUID_DELIMITER = "|";

const normalizeGuid = (raw: string): string => raw.replace(/[{}]/g, "").trim().toLowerCase();

const parseMultilist = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(GUID_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export interface CleanupMultilistRemoveRefOptions extends HygieneCommonOptions {
  /** Sitecore itemId of the target item (GUID, with or without braces). */
  itemId: string;
  /** Field name to mutate — must be a multilist-shaped field. */
  fieldName: string;
  /** GUID to remove. Case-insensitive, brace-tolerant. */
  refToRemove: string;
  /** Standard write-gate plumbing — caller flips when consent established. */
  allowWrite?: boolean;
  /** Plan-only mode. Default false (apply). */
  whatIf?: boolean;
}

export interface CleanupMultilistRemoveRefResult {
  itemId: string;
  fieldName: string;
  refToRemove: string;
  before: string;
  after: string;
  status: "would-change" | "changed" | "no-op";
}

export const runCleanupMultilistRemoveRef = async (
  options: CleanupMultilistRemoveRefOptions
): Promise<readonly CleanupMultilistRemoveRefResult[]> => {
  const logger = toLogger(options);
  if (!options.itemId) {
    throw createScaiError("multilist remove-ref requires `itemId`.", "INPUT_INVALID");
  }
  if (!options.fieldName) {
    throw createScaiError("multilist remove-ref requires `fieldName`.", "INPUT_INVALID");
  }
  if (!options.refToRemove) {
    throw createScaiError("multilist remove-ref requires `refToRemove`.", "INPUT_INVALID");
  }

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    // No OperationId — multilist edit is `write`, not `destructive`
    // (a field-value change, recoverable). The default tier applies.
    ensureAllowWrite(rootConfig, envName, options.allowWrite);
  }

  const fields = await client.getItemFields({ itemId: options.itemId });
  if (!fields) {
    throw createScaiError(`Item ${options.itemId} not found.`, "INPUT_INVALID", {
      hint: "Verify the GUID exists on the tenant.",
    });
  }
  const field = fields.find((f) => f.name.toLowerCase() === options.fieldName.toLowerCase());
  if (!field) {
    throw createScaiError(
      `Field '${options.fieldName}' not found on item ${options.itemId}.`,
      "INPUT_INVALID",
      {
        hint: `Available fields: ${fields.map((f) => f.name).join(", ")}.`,
      }
    );
  }

  const before = field.value ?? "";
  const target = normalizeGuid(options.refToRemove);
  const entries = parseMultilist(before);
  const filtered = entries.filter((entry) => normalizeGuid(entry) !== target);
  const after = filtered.join(GUID_DELIMITER);

  const baseResult = {
    itemId: options.itemId,
    fieldName: field.name,
    refToRemove: options.refToRemove,
    before,
    after,
  };

  if (after === before) {
    if (!logger.isJson()) {
      logger.info(`GUID ${options.refToRemove} not present in field '${field.name}'.`, "gray");
    }
    return [{ ...baseResult, status: "no-op" }];
  }

  if (options.whatIf) {
    if (!logger.isJson()) {
      logger.info(
        `Would remove ${options.refToRemove} from '${field.name}' on ${options.itemId}.`,
        "yellow"
      );
    }
    return [{ ...baseResult, status: "would-change" }];
  }

  await client.updateItemFields({
    itemId: options.itemId,
    fields: [{ name: field.name, value: after }],
  });

  if (!logger.isJson()) {
    logger.info(
      `Removed ${options.refToRemove} from '${field.name}' on ${options.itemId}.`,
      "green"
    );
  }
  return [{ ...baseResult, status: "changed" }];
};
