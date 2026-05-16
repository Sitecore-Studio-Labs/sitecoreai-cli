/**
 * Stdout discipline for `scai mcp serve`.
 *
 * The stdio transport reserves stdout exclusively for JSON-RPC frames.
 * Anything else that lands there breaks the protocol. The library code
 * under scai is generally well-behaved (consola defaults to stderr,
 * spinners and the Logger respect SITECOREAI_QUIET/JSON), but
 * `installMcpStdoutDiscipline()` is the belt-and-braces guard:
 *
 *  1. Sets `SITECOREAI_MCP_SERVE=1`, `SITECOREAI_JSON=1`,
 *     `SITECOREAI_QUIET=1`, `SITECOREAI_NON_INTERACTIVE=1` BEFORE any
 *     other scai module loads. These suppress spinners, banners, and
 *     stdout JSON dumps in the existing task runners.
 *  2. Honors `--no-telemetry`: when telemetry is disabled for the
 *     session it sets `SITECOREAI_TELEMETRY=false`. Otherwise it leaves
 *     the env var untouched so normal resolution applies — telemetry is
 *     on by default and `DO_NOT_TRACK` still wins.
 *  3. Installs a consola reporter that pipes every log line to stderr,
 *     regardless of consola's default level/destination behaviour.
 *
 * Call this at the very top of the `mcp serve` command action, before
 * importing any other scai-internal module that might write to stdout
 * during initialization.
 */

import { consola, type ConsolaReporter } from "consola";

const FLAGS: Array<[string, string]> = [
  ["SITECOREAI_MCP_SERVE", "1"],
  ["SITECOREAI_JSON", "1"],
  ["SITECOREAI_QUIET", "1"],
  ["SITECOREAI_NON_INTERACTIVE", "1"],
];

let installed = false;

export const installMcpStdoutDiscipline = (options: { telemetry?: boolean } = {}): void => {
  if (installed) {
    return;
  }
  installed = true;

  for (const [key, value] of FLAGS) {
    process.env[key] = value;
  }
  if (options.telemetry === false) {
    process.env.SITECOREAI_TELEMETRY = "false";
  }

  const stderrReporter: ConsolaReporter = {
    log: (logObj) => {
      const parts: string[] = [];
      if (logObj.message !== undefined) {
        parts.push(String(logObj.message));
      }
      if (logObj.args && logObj.args.length > 0) {
        for (const arg of logObj.args) {
          parts.push(typeof arg === "string" ? arg : safeStringify(arg));
        }
      }
      const line = parts.join(" ");
      if (line.length > 0) {
        process.stderr.write(`${line}\n`);
      }
    },
  };
  consola.setReporters([stderrReporter]);
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const writeStartupLine = (message: string): void => {
  process.stderr.write(`${message}\n`);
};
