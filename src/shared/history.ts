import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { consola } from "consola";
import { redactArgs, redactSecrets } from "./redact";

export type HistoryEntry = {
  event: "start" | "success" | "error";
  command: string;
  args: string[];
  cwd: string;
  error?: string;
  timestamp?: string;
};

const resolveHistoryPath = (): string =>
  process.env.SITECOREAI_HISTORY_PATH ?? path.join(os.homedir(), ".sitecoreai", "cli-history.log");

const resolveMaxHistoryBytes = (): number =>
  Math.max(0, Number(process.env.SITECOREAI_HISTORY_MAX_BYTES ?? 10 * 1024 * 1024));

const rotateIfNeeded = async (filePath: string): Promise<void> => {
  const maxBytes = resolveMaxHistoryBytes();
  if (maxBytes === 0) {
    return;
  }
  try {
    const stats = await fs.stat(filePath);
    if (stats.size < maxBytes) {
      return;
    }
    const rotated = `${filePath}.${Date.now()}`;
    await fs.rename(filePath, rotated);
  } catch {
    // ignore rotation failures
  }
};

export const recordHistory = async (entry: HistoryEntry): Promise<void> => {
  const filePath = resolveHistoryPath();
  const sanitizedArgs = redactArgs(entry.args ?? []);
  const payload = {
    ...entry,
    args: sanitizedArgs,
    error: entry.error ? redactSecrets(entry.error) : undefined,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await rotateIfNeeded(filePath);
    await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    consola.debug(
      `Unable to write history log: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const getHistoryPath = (): string => resolveHistoryPath();

export const ensureHistoryFile = async (): Promise<void> => {
  const filePath = resolveHistoryPath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, "", "utf8");
  } catch (error) {
    consola.debug(
      `Unable to create history log: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};
