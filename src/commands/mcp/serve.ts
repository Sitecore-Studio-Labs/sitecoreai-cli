/**
 * `scai mcp serve` — launches the stdio MCP server bound to a single
 * Sitecore environment for the lifetime of the process.
 *
 * The handler's first job is `installMcpStdoutDiscipline()` — sets the
 * SITECOREAI_* env vars BEFORE the heavier scai modules load, and
 * redirects every consola log call to stderr. After that point it's
 * safe to import the rest of the scai surface.
 */

import { Command, Option } from "commander";
import { installMcpStdoutDiscipline, writeStartupLine } from "@/mcp/logging";
import { createMcpContextProvider, resolveMcpEnv } from "@/mcp/auth";
import { buildScaiMcpRegistry } from "@/mcp/build-registry";
import { buildMcpServer, startStdioTransport } from "@/mcp/server";
import { toScaiError } from "@/shared/errors";

interface McpServeOptions {
  environmentName?: string;
  config?: string;
  transport?: string;
  telemetry?: boolean;
}

export const runMcpServe = async (options: McpServeOptions): Promise<void> => {
  installMcpStdoutDiscipline({ telemetry: options.telemetry });

  if (options.transport && options.transport !== "stdio") {
    process.stderr.write(
      `Transport '${options.transport}' is not supported in v1. Falling back to stdio.\n`
    );
  }

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
    const server = buildMcpServer({ getContext, registry });

    // Warm the context in the background. If the keychain prompts on macOS,
    // the prompt happens here — concurrent with stdio connect — instead of
    // serializing before it, which is what made `initialize` time out
    // ("still connecting") in some hosts.
    void getContext().catch((error) => {
      const scaiError = toScaiError(error);
      process.stderr.write(
        `scai mcp: deferred env binding failed; first tool call will retry. ${scaiError.message}\n`
      );
    });

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

export const createMcpServeCommand = (): Command => {
  const command = new Command("serve")
    .description("Launch the scai MCP server (stdio transport) bound to a single environment.")
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
      new Option("--transport <kind>", "Transport. Only 'stdio' is supported in v1.")
        .choices(["stdio"])
        .default("stdio")
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
