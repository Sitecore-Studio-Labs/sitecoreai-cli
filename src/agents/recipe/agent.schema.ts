/**
 * `AgentRecipe` — the declarative definition of an Agentic Studio agent.
 *
 * The single source of truth for the `agent` recipe kind: it validates
 * recipe files, drives the `sync` CLI, and becomes the MCP tool input
 * schema. The `.describe()` text is read by the model — keep it accurate.
 */
import { z } from "zod";

export const AgentRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Display name of the agent. Identifies the agent when pushing — recipes match on name, not id."
    ),
  description: z.string().optional().describe("Human description of the agent."),
  prompt: z.string().optional().describe("The agent's system prompt / instructions."),
  tags: z.array(z.string()).default([]).describe("Free-form category labels."),
  executionMode: z
    .string()
    .default("standard")
    .describe('Execution mode — "standard" for a prompt + tools agent.'),
  tools: z
    .record(z.string(), z.boolean())
    .default({})
    .describe(
      'Tool toggles keyed by tool key (e.g. "enableWebSearch", "enableAgentApiContent"). Only keys set here are sent. See `scai agents tool list`.'
    ),
  skills: z
    .array(z.string())
    .default([])
    .describe("Skill slugs to attach. Resolved to skill ids on push."),
  output: z
    .object({
      format: z.enum(["text", "structured"]).default("text").describe("Output format."),
      dynamic: z
        .boolean()
        .optional()
        .describe("Whether a structured schema is selected dynamically."),
    })
    .default({ format: "text" })
    .describe("Agent output mode."),
});

/** A validated agent recipe. */
export type AgentRecipe = z.infer<typeof AgentRecipeSchema>;
