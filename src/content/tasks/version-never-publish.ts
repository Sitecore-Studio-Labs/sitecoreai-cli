/**
 * `scai content version set-never-publish` — set or clear the
 * `__Never publish` flag on a specific item version.
 *
 * Pure CM mutation — DOES NOT auto-publish. After flipping the flag,
 * operators run `scai content publish item` (or `scai content publish unpublish`)
 * separately. Letting these two steps stay independent means an
 * operator can batch several `set-*` changes before paying for the
 * publish round trip.
 */

import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import {
  recordPublishAudit,
  type PublishAuditCaller,
  type PublishAuditFieldChange,
  type PublishAuditScope,
} from "@/publishing/audit";
import {
  FIELD_NEVER_PUBLISH,
  findField,
  formatBoolean,
  writeVersionFields,
} from "@/content/api/version-fields";
import {
  buildLogger,
  computeScopeHash,
  loadVersionSnapshot,
  resolveTargetItemId,
  runSafetyGate,
  type CommonContentVersionOptions,
} from "./shared";

export interface RunContentVersionSetNeverPublishOptions extends CommonContentVersionOptions {
  /** Target value for `__Never publish`. Required. */
  value: boolean;
}

export const runContentVersionSetNeverPublish = async (
  options: RunContentVersionSetNeverPublishOptions
): Promise<void> => {
  const logger = buildLogger(options);
  if (typeof options.value !== "boolean") {
    throw createScaiError("set-never-publish requires --value true|false.", "INPUT_INVALID");
  }
  if (!options.language) {
    throw createScaiError("set-never-publish requires --language.", "INPUT_INVALID");
  }
  const { envName, environment } = resolveEnvironment(options);
  const itemId = await resolveTargetItemId(environment, options);
  const snapshot = await loadVersionSnapshot(
    environment,
    itemId,
    options.language,
    options.version
  );

  const before = findField(snapshot, FIELD_NEVER_PUBLISH);
  const after = formatBoolean(options.value);

  const scope: PublishAuditScope = {
    envName,
    resolvedTenantId: environment.tenantId,
    target: "AuthoringCM",
    kind: "never-publish",
    itemIds: [snapshot.itemId],
    path: snapshot.path,
    languages: [snapshot.language],
    version: snapshot.version,
  };
  const scopeHash = computeScopeHash(scope);

  const change: PublishAuditFieldChange = {
    name: FIELD_NEVER_PUBLISH,
    before,
    after,
  };

  const gate = await runSafetyGate({
    envName,
    environment,
    scope,
    operationLabel: `set-never-publish (${options.value})`,
    options,
    logger,
    describeChange: () => {
      logger.info(`Field:         ${FIELD_NEVER_PUBLISH}`, "gray");
      logger.info(`Before:        ${before ?? "(absent)"}`, "gray");
      logger.info(`After:         ${after === "" ? '"" (false)' : after}`, "gray");
    },
  });
  if (!gate.proceed) {
    return;
  }

  const caller: PublishAuditCaller = { type: "human", via: "cli" };
  try {
    await writeVersionFields(environment, {
      itemId: snapshot.itemId,
      language: snapshot.language,
      version: snapshot.version,
      fields: [{ name: FIELD_NEVER_PUBLISH, value: after }],
    });
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "content version set-never-publish",
      caller,
      scope,
      risk: "normal",
      scopeHash,
      scopeToken: options.confirmToken,
      outcome: "ok",
      fieldChanges: [change],
    });
    if (logger.isJson()) {
      process.stdout.write(
        `${JSON.stringify(
          {
            itemId: snapshot.itemId,
            path: snapshot.path,
            language: snapshot.language,
            version: snapshot.version,
            field: FIELD_NEVER_PUBLISH,
            before,
            after,
          },
          null,
          2
        )}\n`
      );
      return;
    }
    logger.info(
      `Set ${FIELD_NEVER_PUBLISH} on ${snapshot.path} [${snapshot.language} v${snapshot.version}] → ${after === "" ? "false" : "true"}.`,
      "green"
    );
    logger.info(
      `Publish the change with: scai content publish item --items ${snapshot.itemId} -n ${envName}`,
      "gray"
    );
  } catch (err) {
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "content version set-never-publish",
      caller,
      scope,
      risk: "normal",
      scopeHash,
      scopeToken: options.confirmToken,
      outcome: "error",
      errorCode:
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN",
      errorMessage: err instanceof Error ? err.message : String(err),
      fieldChanges: [change],
    });
    throw err;
  }
};
