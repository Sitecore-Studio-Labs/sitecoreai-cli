/**
 * Parent side of the recipe sandbox.
 *
 * `.recipe.ts` is transpiled to a plain CommonJS bundle in this (trusted)
 * process, then run in a forked child locked down with Node's permission
 * model — no worker threads, no `child_process`, no filesystem writes, and
 * filesystem reads scoped to the child-script and temp directories. Only
 * the exported recipe object crosses back over IPC. See docs/recipe-sandbox.md.
 */

import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createScaiError } from "@/shared/errors";
import { transpileRecipe } from "./transpile";

/** Default child timeout — a recipe only exports data; it should be quick. */
const DEFAULT_TIMEOUT_MS = 30_000;

const resolveTimeoutMs = (): number => {
  const raw = Number(process.env.SITECOREAI_RECIPE_SANDBOX_TIMEOUT_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

/**
 * Environment variables the child is allowed to inherit. Everything else —
 * crucially every `SITECOREAI_*` secret and any ambient credential — is
 * withheld, so a hostile recipe has nothing to exfiltrate. Deny-by-default,
 * matching the rest of the guardrails.
 */
const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

const cleanChildEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
};

// The child is a plain `.cjs` shipped beside this module (copied into
// `dist/` by the build) — runnable under bare `node`, no TypeScript
// toolchain, which is what lets the permission model lock it down.
const childPath = path.join(__dirname, "recipe-runner.cjs");

// Symlink-resolved paths for the `--allow-fs-read` grants: Node's
// permission model checks the canonical path, and on macOS `os.tmpdir()`
// (and sometimes the install dir) resolves through a symlink
// (`/var` -> `/private/var`). A grant on the un-resolved path would miss.
const childDir = fs.realpathSync(path.dirname(childPath));
const tmpDir = fs.realpathSync(os.tmpdir());

/** Node permission-model flag — renamed from `--experimental-permission` in v23.5. */
const permissionFlag = (): string => {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 24 ? "--permission" : "--experimental-permission";
};

/** Whether `.recipe.ts` loading is sandboxed. `SITECOREAI_RECIPE_SANDBOX=0` opts out. */
export const isRecipeSandboxEnabled = (): boolean => process.env.SITECOREAI_RECIPE_SANDBOX !== "0";

interface RunnerMessage {
  ok?: boolean;
  recipe?: unknown;
  error?: string;
}

/**
 * Compile a `.recipe.ts` and run it in the confined sandbox child; return
 * the exported recipe object (unvalidated — the caller validates it against
 * the schema).
 */
export const loadRecipeInSandbox = async (filePath: string): Promise<unknown> => {
  const compiled = await transpileRecipe(path.resolve(filePath));
  const bundlePath = path.join(tmpDir, `scai-recipe-${randomUUID()}.cjs`);
  fs.writeFileSync(bundlePath, compiled, "utf8");
  try {
    return await runInChild(filePath, bundlePath);
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }
};

const runInChild = (filePath: string, bundlePath: string): Promise<unknown> => {
  const timeoutMs = resolveTimeoutMs();

  return new Promise<unknown>((resolve, reject) => {
    const child = fork(childPath, [bundlePath], {
      cwd: tmpDir,
      env: cleanChildEnv(),
      // Lock the child down with the permission model: filesystem reads
      // scoped to the child-script directory and the temp directory, and
      // NO --allow-worker / --allow-child-process / --allow-fs-write. The
      // child runs only plain pre-compiled JS, so it never needs those.
      execArgv: [permissionFlag(), `--allow-fs-read=${childDir}`, `--allow-fs-read=${tmpDir}`],
      // Swallow the recipe's stdout; capture stderr (carries the
      // permission-model notice) and surface it only on failure.
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() =>
        reject(
          createScaiError(
            `Loading recipe '${filePath}' timed out after ${timeoutMs} ms in the sandbox.`,
            "INPUT_INVALID",
            {
              hint: "A recipe should only export data — check for long-running or blocking code.",
            }
          )
        )
      );
    }, timeoutMs);

    child.on("message", (message: RunnerMessage) => {
      if (message && message.ok) {
        settle(() => resolve(message.recipe));
        return;
      }
      settle(() =>
        reject(
          createScaiError(
            `Failed to load recipe '${filePath}' in the sandbox: ${message?.error ?? "unknown error"}.`,
            "INPUT_INVALID",
            {
              hint: "A recipe may only compute and export data — filesystem writes and process spawning are blocked in the sandbox.",
            }
          )
        )
      );
    });

    child.on("error", (error) => {
      settle(() =>
        reject(
          createScaiError(
            `Could not start the recipe sandbox for '${filePath}': ${error.message}.`,
            "INPUT_INVALID",
            { hint: "Set SITECOREAI_RECIPE_SANDBOX=0 to load recipes in-process (less safe)." }
          )
        )
      );
    });

    // Fires after a successful message too (the child exits 0 once it has
    // sent the result); `settle` makes the message win that race.
    child.on("exit", (code, signal) => {
      settle(() =>
        reject(
          createScaiError(
            `The recipe sandbox for '${filePath}' exited unexpectedly ` +
              `(code ${code ?? "null"}, signal ${signal ?? "null"})` +
              (stderr.trim() ? `: ${stderr.trim()}` : "."),
            "INPUT_INVALID",
            { hint: "Set SITECOREAI_RECIPE_SANDBOX=0 to load recipes in-process (less safe)." }
          )
        )
      );
    });
  });
};
