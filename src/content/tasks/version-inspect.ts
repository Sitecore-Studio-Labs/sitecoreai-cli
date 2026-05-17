/**
 * `scai content version inspect` — print the publish-state fields for
 * an item version. Read-only; does NOT write the audit log (the
 * audit log records mutations, not reads — keep the trail focused).
 *
 * The output groups the three Sitecore publish-state fields
 * (`__Never publish`, `__Valid from`, `__Valid to`) up top, then dumps
 * the rest of the version's fields for context. JSON mode emits the
 * raw snapshot so it can pipe into jq.
 */

import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import {
  FIELD_NEVER_PUBLISH,
  FIELD_VALID_FROM,
  FIELD_VALID_TO,
  findField,
  parseBoolean,
} from "@/content/api/version-fields";
import {
  buildLogger,
  loadVersionSnapshot,
  resolveTargetItemId,
  type CommonContentVersionOptions,
} from "./shared";

export type RunContentVersionInspectOptions = CommonContentVersionOptions;

export const runContentVersionInspect = async (
  options: RunContentVersionInspectOptions
): Promise<void> => {
  const logger = buildLogger(options);
  if (!options.language) {
    throw createScaiError("inspect requires --language.", "INPUT_INVALID");
  }
  const { environment } = resolveEnvironment(options);
  const itemId = await resolveTargetItemId(environment, options);
  const snapshot = await loadVersionSnapshot(
    environment,
    itemId,
    options.language,
    options.version
  );

  const neverPublishRaw = findField(snapshot, FIELD_NEVER_PUBLISH);
  const validFrom = findField(snapshot, FIELD_VALID_FROM);
  const validTo = findField(snapshot, FIELD_VALID_TO);

  if (logger.isJson()) {
    process.stdout.write(
      `${JSON.stringify(
        {
          itemId: snapshot.itemId,
          name: snapshot.name,
          path: snapshot.path,
          language: snapshot.language,
          version: snapshot.version,
          publishState: {
            neverPublish: parseBoolean(neverPublishRaw),
            neverPublishRaw,
            validFrom: validFrom || null,
            validTo: validTo || null,
          },
          allFields: snapshot.fields,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  logger.info(`Item:          ${snapshot.path}`, "cyan");
  logger.info(`Item ID:       ${snapshot.itemId}`, "gray");
  logger.info(`Language:      ${snapshot.language}`, "gray");
  logger.info(`Version:       ${snapshot.version}`, "gray");
  logger.info(``, "gray");
  logger.info(`Publish state:`, "cyan");
  logger.info(
    `  ${FIELD_NEVER_PUBLISH}: ${parseBoolean(neverPublishRaw) ? "true" : "false"} (raw: '${neverPublishRaw ?? "(absent)"}')`,
    "gray"
  );
  logger.info(`  ${FIELD_VALID_FROM}:    ${validFrom || "(empty)"}`, "gray");
  logger.info(`  ${FIELD_VALID_TO}:      ${validTo || "(empty)"}`, "gray");
};
