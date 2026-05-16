/**
 * `CustomMcpRecipe` — the declarative definition of a registered external
 * MCP server (Agentic Studio custom MCP).
 */
import { z } from "zod";

export const CustomMcpRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Name of the MCP server. Identifies it when pushing — recipes match on name."),
  url: z.string().url().describe("The MCP server endpoint URL."),
});

/** A validated custom-MCP recipe. */
export type CustomMcpRecipe = z.infer<typeof CustomMcpRecipeSchema>;
