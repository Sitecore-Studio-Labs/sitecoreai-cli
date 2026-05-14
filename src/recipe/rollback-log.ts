import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { consola } from "consola";
import { redactSecrets } from "@/shared/redact";

/**
 * On-disk audit log for compensating-op rollbacks during `scai recipe push`.
 *
 * When an apply phase aborts (op error, mid-flight cancel) the executor
 * unwinds applied actions LIFO. Each step's outcome is appended to
 * `<runId>.jsonl` under `~/.sitecoreai/rollback/` so operators can:
 *
 *   - tell at a glance whether rollback completed cleanly,
 *   - find the specific items that rollback failed on (zombie state on
 *     the tenant — the part of "best-effort" the in-memory event count
 *     alone obscures),
 *   - replay the rollback manually with the captured itemIds if needed.
 *
 * The log is lazy: nothing is written if no rollback runs. Successful
 * pushes leave no file. Write failures (full disk, permissions) are
 * swallowed and surfaced through `consola.debug` — never re-thrown,
 * because the caller is already inside a failure path that has its own
 * reason for aborting.
 *
 * Override the directory via `SITECOREAI_ROLLBACK_LOG_DIR`. Matches the
 * pattern established by `src/shared/history.ts`.
 */

export const ROLLBACK_LOG_SCHEMA_VERSION = 1;

export interface RollbackStepLog {
  index: number;
  label: string;
  status: "success" | "failed" | "skip";
  inverse?: "deleteItem" | "updateItem";
  itemId?: string;
  reason?: string;
  error?: string;
}

export interface RollbackSummaryLog {
  trigger: "apply-error" | "plan-error" | "cancelled";
  rolledBack: number;
  errorCount: number;
  forwardError?: string;
}

export interface RollbackLogger {
  readonly runId: string;
  readonly logPath: string;
  /** True once at least one line has been appended to the file. */
  readonly wasUsed: boolean;
  recordStep(recipe: string, entry: RollbackStepLog): Promise<void>;
  recordSummary(recipe: string, entry: RollbackSummaryLog): Promise<void>;
}

export const resolveRollbackLogDir = (): string =>
  process.env.SITECOREAI_ROLLBACK_LOG_DIR ?? path.join(os.homedir(), ".sitecoreai", "rollback");

const writeLine = async (logPath: string, payload: Record<string, unknown>): Promise<boolean> => {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
    return true;
  } catch (error) {
    consola.debug(
      `Unable to append rollback log at ${logPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
};

export interface CreateRollbackLoggerOptions {
  /** Override the log directory. Falls back to `resolveRollbackLogDir()`. */
  dir?: string;
}

export const createRollbackLogger = (
  runId: string,
  options: CreateRollbackLoggerOptions = {}
): RollbackLogger => {
  const dir = options.dir ?? resolveRollbackLogDir();
  const logPath = path.join(dir, `${runId}.jsonl`);
  let used = false;

  const append = async (payload: Record<string, unknown>): Promise<void> => {
    const ok = await writeLine(logPath, {
      v: ROLLBACK_LOG_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      runId,
      ...payload,
    });
    if (ok) used = true;
  };

  const sanitize = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : redactSecrets(value);

  return {
    runId,
    logPath,
    get wasUsed(): boolean {
      return used;
    },
    recordStep: async (recipe, entry) =>
      append({
        kind: "step",
        recipe,
        index: entry.index,
        label: entry.label,
        status: entry.status,
        inverse: entry.inverse,
        itemId: entry.itemId,
        reason: sanitize(entry.reason),
        error: sanitize(entry.error),
      }),
    recordSummary: async (recipe, entry) =>
      append({
        kind: "summary",
        recipe,
        trigger: entry.trigger,
        rolledBack: entry.rolledBack,
        errorCount: entry.errorCount,
        forwardError: sanitize(entry.forwardError),
      }),
  };
};
