/**
 * Sync read / atomic write of the policy artifacts. Sync because the
 * enforcement chokepoint (`resolveEnvironment`) is itself sync.
 */

import fs from "node:fs";
import path from "node:path";
import { createScaiError } from "@/shared/errors";
import { parseRepoPolicy, parseWorkspacePolicy } from "./schema";
import { resolveRepoPolicyPath, resolveUserPolicyPath } from "./paths";
import type { RepoPolicy, WorkspacePolicy } from "./types";

const readJson = (file: string): unknown => {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw createScaiError(`Unable to read ${file}.`, "CONFIG_INVALID", {
      hint: "Check that the file is readable.",
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw createScaiError(`${file} is not valid JSON.`, "CONFIG_INVALID", {
      hint: "Fix the file, or run 'scai policy init' to regenerate the workspace policy.",
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
};

/**
 * Read the user-global workspace policy. Returns `null` when no policy
 * file exists — callers treat that as "unmanaged mode": enforcement is a
 * no-op until the operator runs `scai setup login`, `scai mcp serve`, or
 * `scai policy init`. A present-but-corrupt file fails closed (throws
 * `CONFIG_INVALID`) rather than silently disabling the guardrail.
 */
export const readWorkspacePolicy = (): WorkspacePolicy | null => {
  const file = resolveUserPolicyPath();
  if (!file || !fs.existsSync(file)) {
    return null;
  }
  return parseWorkspacePolicy(readJson(file), file);
};

/** Read the optional repo policy sitting next to the config file. */
export const readRepoPolicy = (configRootDir: string): RepoPolicy | null => {
  const file = resolveRepoPolicyPath(configRootDir);
  if (!fs.existsSync(file)) {
    return null;
  }
  return parseRepoPolicy(readJson(file), file);
};

/**
 * Write the user-global workspace policy. Atomic (temp file + rename) so
 * a crash mid-write can't leave a half-written policy that would
 * fail-closed every later command. Returns the path written, or `null`
 * when no policy directory is resolvable (Vitest without
 * `SITECOREAI_POLICY_HOME`).
 */
export const writeWorkspacePolicy = (policy: WorkspacePolicy): string | null => {
  const file = resolveUserPolicyPath();
  if (!file) {
    return null;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return file;
};

/** Whether the workspace is "managed" — a user-global policy file exists. */
export const isManaged = (): boolean => {
  const file = resolveUserPolicyPath();
  return Boolean(file && fs.existsSync(file));
};
