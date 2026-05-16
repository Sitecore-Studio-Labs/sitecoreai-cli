/**
 * `HtmlTemplateRecipe` — the declarative definition of an Agentic Studio
 * HTML template.
 */
import { z } from "zod";

export const HtmlTemplateRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Display name + identifier of the template. Identifies it when pushing."),
  code: z.string().describe("The template's HTML body."),
  description: z.string().optional().describe("Human description of the template."),
  tags: z.array(z.string()).default([]).describe("Free-form category labels."),
});

/** A validated HTML-template recipe. */
export type HtmlTemplateRecipe = z.infer<typeof HtmlTemplateRecipeSchema>;
