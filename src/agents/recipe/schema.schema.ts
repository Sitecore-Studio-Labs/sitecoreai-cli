/**
 * `SchemaRecipe` — the declarative definition of an Agentic Studio
 * structured-output schema. (`<resource>.schema.ts` — the resource here
 * happens to be a "schema" itself.)
 */
import { z } from "zod";

export const SchemaRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Display name + identifier of the schema. Identifies it when pushing."),
  description: z.string().optional().describe("Human description of the schema."),
  schema: z
    .record(z.string(), z.unknown())
    .describe("The JSON-Schema object the structured output must satisfy."),
  strict: z.boolean().default(true).describe("Enforce the schema strictly."),
  tags: z.array(z.string()).default([]).describe("Free-form category labels."),
});

/** A validated structured-output-schema recipe. */
export type SchemaRecipe = z.infer<typeof SchemaRecipeSchema>;
