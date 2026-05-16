/**
 * `SkillRecipe` — the declarative definition of an Agentic Studio skill
 * (reusable markdown guidance an agent attaches).
 */
import { z } from "zod";

export const SkillRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Skill name. Identifies the skill when pushing — recipes match on name."),
  description: z.string().describe("One-line description of what the skill is for."),
  content: z.string().describe("The skill's markdown guidance — the body the agent reads."),
  tags: z.array(z.string()).default([]).describe("Free-form category labels."),
  visibility: z.string().default("team").describe('Visibility — "team" (shared) or "private".'),
});

/** A validated skill recipe. */
export type SkillRecipe = z.infer<typeof SkillRecipeSchema>;
