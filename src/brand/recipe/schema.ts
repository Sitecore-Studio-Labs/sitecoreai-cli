/**
 * `BrandKitRecipe` — the declarative definition of a Sitecore AI Skills
 * brand kit.
 *
 * This schema is the single source of truth for the `brand-kit` recipe
 * kind: it validates recipe files, drives the `sync` CLI, and becomes
 * the MCP tool input schema. Keep the `.describe()` text accurate — the
 * model reads it. See docs/recipe-sync-architecture.md.
 */
import { z } from "zod";

/** A `richArray`-field entry: text plus optional tags and a constraint. */
export const BrandRichEntrySchema = z.object({
  name: z.string().min(1).describe("The entry's text."),
  tags: z
    .array(z.string())
    .optional()
    .describe('Free-form tags, e.g. "Marketing", "Claims", "Self-Serve".'),
  restrictions: z
    .string()
    .optional()
    .describe('Per-scenario constraint, e.g. "Never use scarcity in marketing copy".'),
});

/**
 * A brand-kit field value. The shape that is valid depends on the live
 * field's type — `text` → string, `array` → string list, `richArray` →
 * rich entries — which the kind resolves against the kit at diff time.
 */
export const BrandFieldValueSchema = z
  .union([z.string(), z.array(z.string()), z.array(BrandRichEntrySchema)])
  .describe("A text value, a list of names, or a list of rich entries.");

/** A brand document to ingest. Sitecore fetches the URL server-side. */
export const BrandDocumentSchema = z.object({
  url: z
    .string()
    .min(1)
    .describe("Publicly reachable URL of a brand document (PDF). Sitecore fetches it server-side."),
  title: z.string().optional().describe("Document title. Defaults to \"brand guidelines\"."),
  summary: z.string().optional().describe("Short document summary."),
});

/** The full brand-kit recipe. */
export const BrandKitRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Display name of the brand kit. Identifies the kit when pushing."),
  description: z.string().optional().describe("Human description of the kit."),
  industry: z
    .string()
    .optional()
    .describe('Industry label, e.g. "retail" or "developer-tools".'),
  documents: z
    .array(BrandDocumentSchema)
    .default([])
    .describe(
      "Brand documents to ingest. On push, when the kit has no populated sections, each is uploaded and run through the ingestion + enrichment pipelines."
    ),
  sections: z
    .record(z.string(), z.record(z.string(), BrandFieldValueSchema))
    .default({})
    .describe(
      "Desired field values, keyed by section name then field name. Sections and fields are created by enrichment; push converges their values."
    ),
});

/** A validated brand-kit recipe. */
export type BrandKitRecipe = z.infer<typeof BrandKitRecipeSchema>;

/** A brand-kit field value (text / name list / rich entries). */
export type BrandFieldValue = z.infer<typeof BrandFieldValueSchema>;

/** A brand document reference within a recipe. */
export type BrandDocument = z.infer<typeof BrandDocumentSchema>;
