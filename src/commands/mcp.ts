import { Command } from "commander";
import { createMcpServeCommand } from "./mcp/serve";
import { createMcpToolsCommand } from "./mcp/tools";

export const createMcpCommand = (): Command => {
  const command = new Command("mcp").description(
    "Model Context Protocol — run an MCP server exposing scai's developer-side surface to agents."
  );
  command.addCommand(createMcpServeCommand());
  command.addCommand(createMcpToolsCommand());
  command.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ scai mcp serve --environment-name dev          # launch stdio server bound to env 'dev'",
      "  $ scai mcp serve --transport http --port 3399    # Streamable HTTP at http://127.0.0.1:3399/mcp",
      "  $ scai mcp tools list                            # list every registered tool (TSV)",
      "  $ scai mcp tools list --names                    # list tool names only, one per line",
      "  $ scai mcp tools schema --name recipe_push      # print one tool's JSON schema",
      "",
    ].join("\n")
  );
  return command;
};
