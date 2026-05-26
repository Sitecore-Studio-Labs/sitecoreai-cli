/**
 * Field-state unpublish strategies — version-scoped writes that change
 * an item's publish state via the Authoring API.
 *
 * Split out of `unpublish.ts` so the version-scoped strategy logic lives
 * apart from the orchestrator and the item-scoped `delete` flow. Both
 * `never-publish` and `expire-now` are reversible.
 */

import { createScaiError } from "@/shared/errors";
import {
  FIELD_NEVER_PUBLISH,
  FIELD_VALID_TO,
  findField,
  formatBoolean,
  readVersionFields,
  writeVersionFields,
} from "@/content/api/version-fields";
import type { PublishAuditFieldChange, UnpublishStrategy } from "@/shared/publish-audit";

/**
 * Apply the strategy to a single `(itemId, language)` pair. Returns
 * the audit-log entries that should be recorded for the field write.
 * Throws if a precondition fails (e.g. version missing for the
 * language) — caller catches and records an error audit entry.
 */
export const applyStrategy = async (
  environment: Parameters<typeof readVersionFields>[0],
  itemId: string,
  language: string,
  strategy: UnpublishStrategy,
  whatIf: boolean
): Promise<PublishAuditFieldChange[]> => {
  const snapshot = await readVersionFields(environment, { itemId, language });

  if (strategy === "never-publish") {
    const before = findField(snapshot, FIELD_NEVER_PUBLISH);
    const after = formatBoolean(true);
    if (!whatIf) {
      await writeVersionFields(environment, {
        itemId: snapshot.itemId,
        language: snapshot.language,
        version: snapshot.version,
        fields: [{ name: FIELD_NEVER_PUBLISH, value: after }],
      });
    }
    return [{ name: FIELD_NEVER_PUBLISH, before, after }];
  }

  if (strategy === "expire-now") {
    const before = findField(snapshot, FIELD_VALID_TO);
    // Sitecore expects ISO 8601 in `__Valid to`; reuse JS toISOString
    // and trim the trailing milliseconds so the wire shape matches
    // what the Sitecore Authoring UI writes.
    const after = new Date().toISOString();
    if (!whatIf) {
      await writeVersionFields(environment, {
        itemId: snapshot.itemId,
        language: snapshot.language,
        version: snapshot.version,
        fields: [{ name: FIELD_VALID_TO, value: after }],
      });
    }
    return [{ name: FIELD_VALID_TO, before, after }];
  }

  // Note: `delete` is not handled here — it's item-scoped (not
  // version-scoped) and runs through `runDeleteUnpublish` in
  // `unpublish-delete.ts`.

  throw createScaiError(
    `Unpublish strategy '${strategy as string}' is not implemented yet.`,
    "INPUT_INVALID",
    {
      hint: "Use --strategy never-publish (default), --strategy expire-now, or --strategy delete.",
    }
  );
};
