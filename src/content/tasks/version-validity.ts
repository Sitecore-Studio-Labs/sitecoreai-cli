/**
 * `scai content version set-validity` — set or clear `__Valid from` /
 * `__Valid to` on a specific item version.
 *
 * Either or both fields may be set per call; passing `--clear-*` writes
 * an empty string to the field (Sitecore's convention for "no date").
 * The four flag pairs (`--valid-from / --clear-valid-from` and
 * `--valid-to / --clear-valid-to`) are mutually exclusive within each
 * pair; the CLI layer enforces that and this task assumes it.
 *
 * Like `set-never-publish`, this does NOT auto-publish.
 */

import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import {
  recordPublishAudit,
  type PublishAuditCaller,
  type PublishAuditFieldChange,
  type PublishAuditScope,
} from "@/shared/publish-audit";
import {
  FIELD_VALID_FROM,
  FIELD_VALID_TO,
  findField,
  writeVersionFields,
  type VersionFieldValue,
} from "@/content/api/version-fields";
import {
  buildLogger,
  computeScopeHash,
  loadVersionSnapshot,
  resolveTargetItemId,
  runSafetyGate,
  type CommonContentVersionOptions,
} from "./shared";

export interface RunContentVersionSetValidityOptions extends CommonContentVersionOptions {
  /** New `__Valid from` value (ISO 8601). Mutually exclusive with
   *  `clearValidFrom`. */
  validFrom?: string;
  clearValidFrom?: boolean;
  /** New `__Valid to` value (ISO 8601). Mutually exclusive with
   *  `clearValidTo`. */
  validTo?: string;
  clearValidTo?: boolean;
}

/**
 * Basic ISO 8601 validation — Sitecore stores the wire form as a
 * string and accepts what the Authoring UI emits. Rather than depend
 * on a date-parsing lib, we do a permissive check that catches the
 * obvious fat-finger ("2026-01-01") cases without false-rejecting
 * tenant-specific formats.
 */
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const assertIso = (label: string, raw?: string): void => {
  if (!raw) return;
  if (!ISO_8601_PATTERN.test(raw)) {
    throw createScaiError(`${label} '${raw}' is not a valid ISO 8601 date.`, "INPUT_INVALID", {
      hint: "Use ISO 8601 e.g. 2026-12-31 or 2026-12-31T23:59:59Z.",
    });
  }
};

export const runContentVersionSetValidity = async (
  options: RunContentVersionSetValidityOptions
): Promise<void> => {
  const logger = buildLogger(options);
  if (!options.language) {
    throw createScaiError("set-validity requires --language.", "INPUT_INVALID");
  }
  if (options.validFrom && options.clearValidFrom) {
    throw createScaiError(
      "Pass either --valid-from or --clear-valid-from, not both.",
      "INPUT_INVALID"
    );
  }
  if (options.validTo && options.clearValidTo) {
    throw createScaiError("Pass either --valid-to or --clear-valid-to, not both.", "INPUT_INVALID");
  }
  if (!options.validFrom && !options.clearValidFrom && !options.validTo && !options.clearValidTo) {
    throw createScaiError(
      "set-validity requires at least one of --valid-from / --clear-valid-from / --valid-to / --clear-valid-to.",
      "INPUT_INVALID"
    );
  }
  assertIso("--valid-from", options.validFrom);
  assertIso("--valid-to", options.validTo);

  const { envName, environment } = resolveEnvironment(options);
  const itemId = await resolveTargetItemId(environment, options);
  const snapshot = await loadVersionSnapshot(
    environment,
    itemId,
    options.language,
    options.version
  );

  const fieldsToWrite: VersionFieldValue[] = [];
  const changes: PublishAuditFieldChange[] = [];

  if (options.validFrom !== undefined || options.clearValidFrom) {
    const before = findField(snapshot, FIELD_VALID_FROM);
    const after = options.clearValidFrom ? "" : (options.validFrom as string);
    fieldsToWrite.push({ name: FIELD_VALID_FROM, value: after });
    changes.push({
      name: FIELD_VALID_FROM,
      before,
      after: options.clearValidFrom ? null : after,
    });
  }
  if (options.validTo !== undefined || options.clearValidTo) {
    const before = findField(snapshot, FIELD_VALID_TO);
    const after = options.clearValidTo ? "" : (options.validTo as string);
    fieldsToWrite.push({ name: FIELD_VALID_TO, value: after });
    changes.push({
      name: FIELD_VALID_TO,
      before,
      after: options.clearValidTo ? null : after,
    });
  }

  const scope: PublishAuditScope = {
    envName,
    resolvedTenantId: environment.tenantId,
    target: "AuthoringCM",
    kind: "validity",
    itemIds: [snapshot.itemId],
    path: snapshot.path,
    languages: [snapshot.language],
    version: snapshot.version,
  };
  const scopeHash = computeScopeHash(scope);

  const gate = await runSafetyGate({
    envName,
    environment,
    scope,
    operationLabel: "set-validity",
    options,
    logger,
    describeChange: () => {
      for (const c of changes) {
        const beforeStr = c.before == null || c.before === "" ? "(empty)" : c.before;
        const afterStr = c.after == null || c.after === "" ? "(cleared)" : c.after;
        logger.info(`Field: ${c.name}`, "gray");
        logger.info(`  Before:  ${beforeStr}`, "gray");
        logger.info(`  After:   ${afterStr}`, "gray");
      }
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
      fields: fieldsToWrite,
    });
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "content version set-validity",
      caller,
      scope,
      risk: "normal",
      scopeHash,
      scopeToken: options.confirmToken,
      outcome: "ok",
      fieldChanges: changes,
    });
    if (logger.isJson()) {
      process.stdout.write(
        `${JSON.stringify(
          {
            itemId: snapshot.itemId,
            path: snapshot.path,
            language: snapshot.language,
            version: snapshot.version,
            changes,
          },
          null,
          2
        )}\n`
      );
      return;
    }
    logger.info(
      `Updated validity on ${snapshot.path} [${snapshot.language} v${snapshot.version}].`,
      "green"
    );
    logger.info(
      `Publish the change with: scai content publish item --items ${snapshot.itemId} -n ${envName}`,
      "gray"
    );
  } catch (err) {
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "content version set-validity",
      caller,
      scope,
      risk: "normal",
      scopeHash,
      scopeToken: options.confirmToken,
      outcome: "error",
      errorCode:
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN",
      errorMessage: err instanceof Error ? err.message : String(err),
      fieldChanges: changes,
    });
    throw err;
  }
};
