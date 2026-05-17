/**
 * CLI presentation helpers for `scai provision deploy` task runners —
 * JSON-aware result printing.
 *
 * Env-context resolution and project / environment / organization
 * lookup moved to `@/deploy/context` (presentation-free, barrel-
 * exported); this file re-exports them so the runners keep their
 * `./shared` import surface. Neutral helpers (`toLogger`, `selectMatch`,
 * `confirmDestructive`, etc.) live in `@/shared/cli-tasks`.
 */

import { Logger } from "@/shared/logger";
import { buildScaiEnvelope } from "@/shared/envelope";

// Re-export neutral helpers so deploy task runners can keep using
// the local `./shared` import surface; new code can also import
// these directly from `@/shared/cli-tasks`.
export {
  toLogger,
  applyIfDefined,
  inputError,
  confirmDestructive,
  selectMatch,
  selectFromList,
  resolveApiTimeoutMs,
} from "@/shared/cli-tasks";

// Re-export the presentation-free deploy context + lookup helpers so the
// runners keep their `./shared` import surface.
export * from "@/deploy/context";

export const printDeployResult = (logger: Logger, data: unknown): void => {
  if (data === undefined || data === null || data === "") {
    logger.info("Request succeeded (empty response).", "green");
    return;
  }
  if (logger.isJson()) {
    logger.json(data);
    return;
  }
  try {
    logger.info(JSON.stringify(data, null, 2));
  } catch {
    logger.info(String(data));
  }
};

export const printDeployResultWithContext = (
  logger: Logger,
  context: { envName?: string },
  command: string,
  result: unknown,
  extra: Record<string, unknown> = {}
): void => {
  if (logger.isJson()) {
    // `extra` keys overlapping with canonical envelope fields
    // (totalCount, pageSize, whatIf, etc.) are hoisted to envelope-
    // level; anything else lands under `meta`. Keeps the top-level
    // namespace clean while preserving the caller's ability to attach
    // pagination metadata without nesting it under `data`.
    logger.json(buildScaiEnvelope({ command, environment: context.envName, data: result, extra }));
    return;
  }
  printDeployResult(logger, result);
};

export const printDeployWhatIf = (
  logger: Logger,
  context: { envName?: string },
  command: string,
  request: Record<string, unknown>
): void => {
  if (logger.isJson()) {
    logger.json(
      buildScaiEnvelope({
        command,
        environment: context.envName,
        data: request,
        extra: { whatIf: true },
      })
    );
    return;
  }
  printDeployResult(logger, { whatIf: true, request });
};
