/**
 * `BriefTypeRecipe` — the declarative definition of a Sitecore Content
 * Operations brief type (the schema template a brief instance is built
 * against).
 *
 * This schema is the single source of truth for the `brief-type` recipe
 * kind: it validates recipe files, drives the `sync` CLI, and becomes
 * the MCP tool input schema. Keep the `.describe()` text accurate — the
 * model reads it. See docs/recipe-sync-architecture.md.
 *
 * Brief *instances* are runtime data and are out of scope — this kind
 * covers only the type/config (its fields).
 */
import { z } from "zod";

/** A localized label: BCP-47-ish locale (e.g. `en-us`) → string. */
export const LocalizedStringSchema = z
  .record(z.string(), z.string())
  .describe('Localized text, keyed by BCP-47-ish locale, e.g. { "en-us": "Creative Brief" }.');

/** Properties every brief-type field carries, regardless of `type`. */
const briefFieldBaseShape = {
  name: z
    .string()
    .min(1)
    .describe("Stable field codename — the key a brief instance stores its value under."),
  label: LocalizedStringSchema.describe("Localized human label shown in the brief authoring UI."),
  helpText: LocalizedStringSchema.optional().describe(
    "Optional localized help text for the field."
  ),
  required: z.boolean().describe("Whether the field must be filled before the brief can advance."),
  aiEditable: z
    .boolean()
    .describe("Whether AI assistants may write this field. `aiIntent` is read either way."),
  aiIntent: z
    .string()
    .optional()
    .describe("Free-form prompt describing to AI clients how to fill the field."),
} as const;

/** A free-form rich-text field. */
export const RichTextFieldSchema = z
  .object({
    type: z.literal("RichText").describe("Discriminator — a rich-text field."),
    ...briefFieldBaseShape,
  })
  .describe("A rich-text field.");

/** A single date-time field. */
export const DateTimeFieldSchema = z
  .object({
    type: z.literal("DateTime").describe("Discriminator — a date-time field."),
    ...briefFieldBaseShape,
  })
  .describe("A date-time field.");

/**
 * A simple boolean field (true/false). Observed on SitecoreAI's
 * built-in types — `SitecoreAIEvaluation.QualifiedBANT` is a Boolean
 * gate the rest of the eval defers to. Persisted as `true`/`false` on
 * brief instances.
 */
export const BooleanFieldSchema = z
  .object({
    type: z.literal("Boolean").describe("Discriminator — a true/false field."),
    ...briefFieldBaseShape,
  })
  .describe("A boolean field.");

/** A timeline field — a schedule with holiday/weekend handling. */
export const TimelineFieldSchema = z
  .object({
    type: z.literal("Timeline").describe("Discriminator — a timeline/schedule field."),
    ...briefFieldBaseShape,
    calculation: z
      .number()
      .describe("Schedule calculation strategy enum — observed value `0`; semantics TBD."),
    skipHolidays: z.boolean().describe("Whether the schedule skips public holidays."),
    skipWeekend: z.boolean().describe("Whether the schedule skips weekends."),
    timezone: z.string().describe("IANA timezone string for the schedule; may be empty."),
  })
  .describe("A timeline/schedule field.");

/** A budget field — a monetary value constrained to a currency set. */
export const BudgetFieldSchema = z
  .object({
    type: z.literal("Budget").describe("Discriminator — a budget/currency field."),
    ...briefFieldBaseShape,
    currencies: z
      .array(
        z
          .string()
          .length(3)
          .regex(/^[A-Z]{3}$/, "ISO-4217 currency code must be 3 uppercase letters (e.g. `USD`).")
      )
      .describe('ISO-4217 currency codes the field accepts, e.g. ["USD", "EUR"].'),
  })
  .describe("A budget/currency field.");

/** A brief-type field — discriminated on `type`. */
export const BriefFieldSchema = z
  .discriminatedUnion("type", [
    RichTextFieldSchema,
    DateTimeFieldSchema,
    BooleanFieldSchema,
    TimelineFieldSchema,
    BudgetFieldSchema,
  ])
  .describe(
    "A field definition: one of RichText, DateTime, Boolean, Timeline, or Budget.",
  );

/** The full brief-type recipe. */
export const BriefTypeRecipeSchema = z.object({
  name: z
    .string()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]*$/,
      "Must start with a letter and contain only letters, digits, or underscores."
    )
    .describe(
      "Stable codename of the brief type, e.g. `Creative`. Identifies the type when pushing."
    ),
  label: LocalizedStringSchema.describe("Localized human label for the brief type."),
  description: z.string().describe("Human description of what the brief type is for."),
  icon: z.string().describe("mdi icon codepoint name shown in the brief authoring UI."),
  iconColor: z.string().describe("Hex or named color paired with the icon."),
  fields: z
    .array(BriefFieldSchema)
    .default([])
    .describe("Field definitions in display order. An empty list is valid."),
});

/** A validated brief-type recipe. */
export type BriefTypeRecipe = z.infer<typeof BriefTypeRecipeSchema>;

/** A brief-type field within a recipe (discriminated on `type`). */
export type BriefRecipeField = z.infer<typeof BriefFieldSchema>;

/** A localized string within a recipe. */
export type RecipeLocalizedString = z.infer<typeof LocalizedStringSchema>;
