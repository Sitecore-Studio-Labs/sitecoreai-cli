/**
 * Parent side of the recipe sandbox — spawns the confined child
 * (`./recipe-loader.ts`) that loads a `.recipe.ts`, and returns the
 * recipe object it sends back. See docs/recipe-sandbox.md.
 */

import { fork } from "node:child_process";
import path from "node:path";
import { createScaiError } from "@/shared/errors";

/** Default child timeout — a recipe only exports data; it should be quick. */
const DEFAULT_TIMEOUT_MS = 30_000;

const resolveTimeoutMs = (): number => {
  const raw = Number(process.env.SITECOREAI_RECIPE_SANDBOX_TIMEOUT_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

/**
 * Environment variables the child is allowed to inherit. Everything else —
 * crucially every `SITECOREAI_*` secret and any ambient credential — is
 * withheld, so a hostile recipe has nothing to exfiltrate. This is an
 * allowlist (deny-by-default), matching the rest of the guardrails.
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
  "NODE_PATH",
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

// In dev / tests this module runs from `.ts` source (via tsx / vitest); in a
// published build it is compiled `.js`. The child sits beside it either way.
const runningFromSource = __filename.endsWith(".ts");
const childModulePath = path.join(
  __dirname,
  runningFromSource ? "recipe-loader.ts" : "recipe-loader.js"
);

/**
 * `execArgv` for the child. When running from `.ts` source the child is
 * itself TypeScript, so Node needs the tsx require hook to execute it —
 * passed as an absolute path so it resolves regardless of the child's cwd
 * (which we point at the recipe's directory). A compiled build needs none.
 */
const childExecArgv = (): string[] => {
  if (!runningFromSource) {
    return [];
  }
  return ["--require", require.resolve("tsx/cjs")];
};

/** Whether `.recipe.ts` loading is sandboxed. `SITECOREAI_RECIPE_SANDBOX=0` opts out. */
export const isRecipeSandboxEnabled = (): boolean => process.env.SITECOREAI_RECIPE_SANDBOX !== "0";

interface LoaderMessage {
  ok?: boolean;
  recipe?: unknown;
  error?: string;
}

/**
 * Load a `.recipe.ts` in a confined child process and return its exported
 * recipe object (unvalidated — the caller validates it against the schema).
 */
export const loadRecipeInSandbox = (filePath: string): Promise<unknown> => {
  const absolute = path.resolve(filePath);
  const timeoutMs = resolveTimeoutMs();

  return new Promise<unknown>((resolve, reject) => {
    const child = fork(childModulePath, [absolute], {
      cwd: path.dirname(absolute),
      env: cleanChildEnv(),
      // Dev/test: the child is `.ts`, so Node needs the tsx require hook to
      // run it. A published build ships compiled `.js` and needs nothing.
      execArgv: childExecArgv(),
      // Swallow the recipe's stdout (a recipe must not pollute scai output);
      // keep stderr for genuine diagnostics; `ipc` carries the result.
      stdio: ["ignore", "ignore", "inherit", "ipc"],
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

    child.on("message", (message: LoaderMessage) => {
      if (message && message.ok) {
        settle(() => resolve(message.recipe));
        return;
      }
      settle(() =>
        reject(
          createScaiError(
            `Failed to load recipe '${filePath}' in the sandbox: ${message?.error ?? "unknown error"}.`,
            "INPUT_INVALID",
            { hint: "Confirm the file compiles standalone (try `pnpm exec tsx <file>`)." }
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
              `(code ${code ?? "null"}, signal ${signal ?? "null"}).`,
            "INPUT_INVALID",
            { hint: "Confirm the file compiles standalone (try `pnpm exec tsx <file>`)." }
          )
        )
      );
    });
  });
};
