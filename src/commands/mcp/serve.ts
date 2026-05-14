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
import { bindMcpEnvironment } from "@/mcp/auth";
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
    const context = await bindMcpEnvironment({
      configPath: options.config,
      environmentName: options.environmentName,
    });
    const registry = buildScaiMcpRegistry();
    const server = buildMcpServer({ context, registry });
    writeStartupLine(
      `scai mcp serve listening on stdio, bound to environment '${context.envName}'`
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
