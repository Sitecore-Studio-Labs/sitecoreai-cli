/**
 * `WidgetRecipe` — the declarative definition of an Agentic Studio widget
 * (a configurable report/dashboard surface).
 */
import { z } from "zod";

/** A widget's declarative UI spec — a tree of typed elements. */
export const WidgetSpecSchema = z.object({
  root: z.string().describe("Id of the root element in `elements`."),
  elements: z
    .record(z.string(), z.unknown())
    .describe("Map of element id → element definition (type, props, children)."),
});

export const WidgetRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Widget name. Identifies the widget when pushing — recipes match on name."),
  description: z.string().optional().describe("Human description of the widget."),
  spec: WidgetSpecSchema.describe("The widget's declarative UI spec."),
});

/** A validated widget recipe. */
export type WidgetRecipe = z.infer<typeof WidgetRecipeSchema>;
