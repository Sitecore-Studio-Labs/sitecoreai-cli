/**
 * Neutral helpers shared across every CLI task family. Anything
 * deploy-specific belongs in `src/deploy/tasks/shared.ts`; anything
 * serialization-specific belongs in `src/serialization/tasks/shared.ts`.
 */

import type { RootConfiguration } from "@/config";
import { Logger } from "@/shared/logger";
import { promptConfirm, promptText } from "@/shared/prompt";
import { createScaiError } from "@/shared/errors";
import type { CommonOptions } from "./cli-options";

export const toLogger = (options: CommonOptions): Logger => {
  const logFile = options.logFile ?? process.env.SITECOREAI_LOG_FILE;
  return new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    logFile
  );
};

export const applyIfDefined = <T>(target: T, key: keyof T, value: T[keyof T] | undefined): void => {
  if (value !== undefined) {
    target[key] = value;
  }
};

export const inputError = (message: string, hint?: string): Error =>
  createScaiError(message, "INPUT_INVALID", hint ? { hint } : {});

export const confirmDestructive = async (message: string, force?: boolean): Promise<boolean> => {
  if (force) {
    return true;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw createScaiError("Confirmation required for destructive action.", "INPUT_INVALID", {
      hint: "Re-run with --force to skip the confirmation prompt.",
    });
  }
  return promptConfirm(message, false);
};

export const selectMatch = <
  T extends { id?: string; name?: string; projectId?: string; environmentId?: string },
>(
  list: T[],
  label: string,
  selection?: string
): T => {
  if (!selection) {
    if (list.length === 1) {
      return list[0];
    }
    throw inputError(
      `${label} must be specified when multiple results are available: ${list
        .map((item) => item.name ?? item.id ?? item.projectId ?? item.environmentId ?? "(unknown)")
        .join(", ")}`
    );
  }
  const match = list.find(
    (item) =>
      item.id === selection ||
      item.projectId === selection ||
      item.environmentId === selection ||
      (item.name && item.name.toLowerCase() === selection.toLowerCase())
  );
  if (!match) {
    throw inputError(`${label} '${selection}' was not found.`);
  }
  return match;
};

export const selectFromList = async <
  T extends { id?: string; name?: string; projectId?: string; environmentId?: string },
>(
  logger: Logger,
  label: string,
  list: T[]
): Promise<T> => {
  if (list.length === 1) {
    return list[0];
  }
  logger.info(`${label} choices:`, "cyan");
  list.forEach((item, index) => {
    const id = item.id ?? item.projectId ?? item.environmentId ?? "-";
    const name = item.name ?? id;
    logger.info(`  ${index + 1}) ${name} (${id})`);
  });
  const selection = await promptText(`${label} (number or id/name)`);
  const index = Number(selection);
  if (!Number.isNaN(index) && index >= 1 && index <= list.length) {
    return list[index - 1];
  }
  return selectMatch(list, label, selection);
};

export const resolveApiTimeoutMs = (root: RootConfiguration): number | undefined => {
  const minutes = root.settings.apiClientTimeoutInMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return minutes * 60 * 1000;
};

/**
 * `Promise.all`-style fan-out, but with a concurrency cap. Use this when
 * mapping over an unbounded list (recipe files, environment fetches,
 * etc.) where `Promise.all(items.map(fn))` would race N parallel
 * I/O calls — fine for small N, a footgun for workspaces with hundreds
 * of items. Order of the returned array matches the input order.
 *
 * Defaults to 8: enough to saturate the file-system on a normal laptop,
 * conservative enough not to thrash a slow disk or thunder-herd a remote
 * API. Pass a lower limit when each task hits the same upstream.
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 8
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};
