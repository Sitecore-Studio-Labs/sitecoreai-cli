/**
 * `scai mcp serve` — launches the MCP server bound to a single Sitecore
 * environment for the lifetime of the process.
 *
 * Two transports, selected with `--transport`:
 *   - `stdio` (default) — a desktop MCP host spawns scai as a child
 *     process and drives it over stdin/stdout.
 *   - `http` — a Streamable HTTP listener at `http://<host>:<port>/mcp`
 *     so URL-based clients (including browser-hosted ones) can connect.
 *
 * The handler's first job is `installMcpStdoutDiscipline()` — sets the
 * SITECOREAI_* env vars BEFORE the heavier scai modules load, and
 * redirects every consola log call to stderr. After that point it's
 * safe to import the rest of the scai surface.
 */

import { Command, InvalidArgumentError, Option } from "commander";
import { installMcpStdoutDiscipline, writeStartupLine } from "@/mcp/logging";
import { createMcpContextProvider, resolveMcpEnv } from "@/mcp/auth";
import { buildScaiMcpRegistry } from "@/mcp/build-registry";
import { buildMcpServer, startStdioTransport } from "@/mcp/server";
import { startHttpTransport } from "@/mcp/http";
import { toScaiError } from "@/shared/errors";

const DEFAULT_HTTP_PORT = 3399;
const DEFAULT_HTTP_HOST = "127.0.0.1";

interface McpServeOptions {
  environmentName?: string;
  config?: string;
  transport?: string;
  port?: number;
  host?: string;
  telemetry?: boolean;
}

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "::1" || host === "localhost";

export const runMcpServe = async (options: McpServeOptions): Promise<void> => {
  installMcpStdoutDiscipline({ telemetry: options.telemetry });

  try {
    // Fail-fast on bad config (sync read, no keychain involved). Bad config
    // is a setup error — surface it at startup, not buried in a tool result.
    const resolved = resolveMcpEnv({
      configPath: options.config,
      environmentName: options.environmentName,
    });
    const configPath = options.config ?? process.cwd();
    const getContext = createMcpContextProvider(resolved, configPath);
    const registry = buildScaiMcpRegistry();

    // Warm the context in the background. If the keychain prompts on macOS,
    // the prompt happens here — concurrent with transport connect — instead
    // of serializing before it, which is what made `initialize` time out
    // ("still connecting") in some hosts.
    void getContext().catch((error) => {
      const scaiError = toScaiError(error);
      process.stderr.write(
        `scai mcp: deferred env binding failed; first tool call will retry. ${scaiError.message}\n`
      );
    });

    if (options.transport === "http") {
      const host = options.host ?? DEFAULT_HTTP_HOST;
      const port = options.port ?? DEFAULT_HTTP_PORT;
      if (!isLoopbackHost(host)) {
        process.stderr.write(
          `scai mcp: warning — binding to non-loopback host '${host}'. The MCP tool ` +
            `surface (environment reads + allowWrite-gated writes) becomes reachable ` +
            `from your network.\n`
        );
      }
      const handle = await startHttpTransport({ getContext, registry, host, port });
      writeStartupLine(
        `scai mcp serve listening on ${handle.url}, bound to environment '${resolved.envName}'`
      );
      // The open listener keeps the process alive; close it cleanly on
      // an interrupt so in-flight response streams aren't severed mid-frame.
      const shutdown = (): void => {
        void handle.close().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return;
    }

    const server = buildMcpServer({ getContext, registry });
    writeStartupLine(
      `scai mcp serve listening on stdio, bound to environment '${resolved.envName}'`
    );
    await startStdioTransport(server);
  } catch (error) {
    const scaiError = toScaiError(error);
    process.stderr.write(`scai mcp serve failed: ${scaiError.message}\n`);
    if (scaiError.hint) {
      process.stderr.write(`hint: ${scaiError.hint}\n`);
    }
    process.exitCode = scaiError.exitCode;
  }
};

const parsePort = (value: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError("Port must be an integer between 1 and 65535.");
  }
  return port;
};

export const createMcpServeCommand = (): Command => {
  const command = new Command("serve")
    .description("Launch the scai MCP server (stdio or Streamable HTTP) bound to one environment.")
    .addOption(
      new Option(
        "-n, --environment-name <name>",
        "Config environment name from sitecoreai.cli.json (defaults to defaultEnvProfile)."
      )
    )
    .addOption(
      new Option(
        "-c, --config <path>",
        "Path to sitecoreai.cli.json or a directory containing one."
      ).default(process.cwd())
    )
    .addOption(
      new Option("--transport <kind>", "Transport: 'stdio' (default) or 'http' (Streamable HTTP).")
        .choices(["stdio", "http"])
        .default("stdio")
    )
    .addOption(
      new Option("--port <number>", "HTTP transport port (only used with --transport http).")
        .argParser(parsePort)
        .default(DEFAULT_HTTP_PORT)
    )
    .addOption(
      new Option(
        "--host <address>",
        "HTTP transport bind address (only used with --transport http)."
      ).default(DEFAULT_HTTP_HOST)
    )
    .addOption(
      new Option(
        "--telemetry",
        "Enable telemetry for this MCP session. Default: telemetry is disabled in MCP mode."
      )
    );
  command.action(async (options: McpServeOptions) => runMcpServe(options));
  return command;
};
