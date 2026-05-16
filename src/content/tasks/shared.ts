/**
 * Shared scaffolding for `scai content version *` tasks.
 *
 * Each verb (set-validity, set-never-publish, inspect) follows the
 * same pattern: resolve `(itemId or path, language, version?)` → load
 * the current version snapshot → apply the verb-specific logic →
 * audit. The boilerplate around env resolution, path → id resolution,
 * tier gating and the dry-run / `--allow-write` / `--confirm-token`
 * dance is identical, so it lives here.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { promptConfirm } from "@/shared/prompt";
import {
  computeScopeHash,
  mintScopeToken,
  SCOPE_TOKEN_TTL_MS,
  verifyScopeToken,
} from "@/publishing/consent";
import { isProductionTier } from "@/publishing/env-tier";
import type { PublishAuditScope } from "@/publishing/audit";
import {
  readVersionFields,
  resolveSinglePathToId,
  type VersionFieldsSnapshot,
} from "@/content/api/version-fields";

export interface CommonContentVersionOptions {
  config?: string;
  environmentName?: string;
  itemId?: string;
  path?: string;
  language: string;
  /** Specific version (1-indexed). Undefined → latest. */
  version?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  confirmToken?: string;
  yes?: boolean;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

export const buildLogger = (options: CommonContentVersionOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

/**
 * Resolve `--item-id` or `--path` into a canonical itemId. Errors if
 * neither (or both) are supplied — the verbs are single-item by
 * design, so an unambiguous target is a pre-condition.
 */
export const resolveTargetItemId = async (
  environment: EnvironmentConfiguration,
  options: { itemId?: string; path?: string }
): Promise<string> => {
  if (options.itemId && options.path) {
    throw createScaiError("Pass either --item-id or --path, not both.", "INPUT_INVALID");
  }
  if (options.itemId) {
    return options.itemId.replace(/[{}]/g, "");
  }
  if (options.path) {
    return resolveSinglePathToId(environment, options.path);
  }
  throw createScaiError(
    "Pass --item-id <guid> or --path <path> to identify the target item.",
    "INPUT_INVALID"
  );
};

/**
 * Read the current version snapshot. Resolves the request-time
 * "latest" (`version` undefined) into the concrete version number on
 * the returned snapshot, so subsequent writes can pin the exact
 * version they intended. Audit log carries the concrete version for
 * the same reason.
 */
export const loadVersionSnapshot = async (
  environment: EnvironmentConfiguration,
  itemId: string,
  language: string,
  version?: number
): Promise<VersionFieldsSnapshot> => readVersionFields(environment, { itemId, language, version });

const printScope = (logger: Logger, scope: PublishAuditScope, label: string): void => {
  logger.info(`Environment:   ${scope.envName}`, "cyan");
  if (scope.resolvedTenantId) {
    logger.info(`Tenant:        ${scope.resolvedTenantId}`, "gray");
  }
  logger.info(`Operation:     ${label}`, "gray");
  if (scope.itemIds && scope.itemIds.length > 0) {
    logger.info(`Item ID:       ${scope.itemIds[0]}`, "gray");
  }
  if (scope.path) {
    logger.info(`Path:          ${scope.path}`, "gray");
  }
  if (scope.languages && scope.languages.length > 0) {
    logger.info(`Language:      ${scope.languages[0]}`, "gray");
  }
  if (scope.version !== undefined) {
    logger.info(`Version:       ${scope.version}`, "gray");
  }
};

export interface SafetyGateInput {
  envName: string;
  environment: EnvironmentConfiguration;
  scope: PublishAuditScope;
  /** Friendly label printed in dry-run / prompt output ("set-validity",
   *  "set-never-publish", etc.). */
  operationLabel: string;
  options: Pick<
    CommonContentVersionOptions,
    "allowWrite" | "whatIf" | "confirmToken" | "yes" | "nonInteractive"
  >;
  logger: Logger;
  /** Optional renderer for any verb-specific dry-run lines (e.g. "would
   *  set __Never publish: true"). Invoked before the scope-token
   *  printout. */
  describeChange?: () => void;
}

export type SafetyGateResult = { proceed: false } | { proceed: true; whatIf: false };

/**
 * Apply the standard dry-run / allow-write / confirm-token / prompt
 * cascade. Returns `proceed: true` only when the caller should
 * actually issue the write. Mirrors the layering used in
 * `runPublishItem`.
 *
 * The `describeChange` hook lets each verb print its specific intended
 * mutation (e.g. "would write `__Never publish` from `false` → `true`")
 * before the shared "Scope token" footer.
 */
export const runSafetyGate = async (input: SafetyGateInput): Promise<SafetyGateResult> => {
  const { envName, environment, scope, operationLabel, options, logger } = input;
  const whatIf = options.allowWrite ? Boolean(options.whatIf) : true;
  const productionTier = isProductionTier(environment);

  if (whatIf) {
    logger.warn(`What-if: would apply ${operationLabel} in env '${envName}'.`, "yellow");
    printScope(logger, scope, operationLabel);
    if (input.describeChange) {
      input.describeChange();
    }
    const token = mintScopeToken(scope);
    logger.info("", "gray");
    if (productionTier) {
      logger.info(
        `Production-tier env. Real call requires --allow-write AND --confirm-token.`,
        "yellow"
      );
    }
    logger.info(`Scope token (TTL ${SCOPE_TOKEN_TTL_MS / 1000}s):`, "gray");
    process.stdout.write(`${token}\n`);
    logger.info("", "gray");
    logger.info(
      `To execute: rerun with --allow-write${productionTier ? ` --confirm-token ${token}` : ""}`,
      "gray"
    );
    return { proceed: false };
  }

  if (productionTier) {
    if (!options.confirmToken) {
      throw createScaiError(
        `Production-tier env '${envName}' requires --confirm-token.`,
        "INPUT_INVALID",
        {
          hint: "Run the same command without --allow-write to mint a scope token, then pass it back as --confirm-token <token>.",
        }
      );
    }
    const verification = verifyScopeToken(options.confirmToken, scope);
    if (!verification.ok) {
      throw createScaiError(`Scope token rejected (${verification.reason}).`, "INPUT_INVALID", {
        hint: "Re-run the dry-run to mint a fresh token; the scope or env may have changed since the token was issued.",
      });
    }
  } else if (!options.yes) {
    if (options.nonInteractive) {
      throw createScaiError(
        "Non-interactive mode requires --yes (or --confirm-token on prod envs).",
        "INPUT_INVALID"
      );
    }
    logger.info(`About to apply ${operationLabel} in env '${envName}'.`, "yellow");
    printScope(logger, scope, operationLabel);
    if (input.describeChange) {
      input.describeChange();
    }
    const ok = await promptConfirm(`Proceed with ${operationLabel}?`, false);
    if (!ok) {
      logger.info("Aborted.", "yellow");
      return { proceed: false };
    }
  }

  return { proceed: true, whatIf: false };
};

/** Re-exported so verb tasks don't have to know which helper module
 *  hosts the canonical hash function. */
export { computeScopeHash };
