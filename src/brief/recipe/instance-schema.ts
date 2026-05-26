/**
 * `BriefInstanceRecipe` — the declarative definition of a Sitecore
 * Content Operations *brief instance* (the unit of work — a populated
 * brief built against a `BriefType` schema).
 *
 * Companion to `BriefTypeRecipeSchema` (this file's sibling `schema.ts`,
 * which models the schema template). Brief instances reference their
 * type by stable codename (`briefTypeName`) rather than UUID, exactly as
 * a `campaign` recipe references nothing by id and identifies itself by
 * `name`. See docs/recipe-sync-architecture.md.
 *
 * The schema captures the fields `createBrief` / `updateBrief` accept
 * on the Brief API — `name`, `briefTypeName`, `locale`, `status`,
 * `isTemplate`, and the per-field `fields` map. Sub-resources (tasks,
 * comments, references, contributors, external mappings) are returned
 * by the read endpoints but are not part of the brief write surface,
 * so they stay out of the recipe.
 */
import { z } from "zod";

/**
 * Brief workflow status — the values the Brief API accepts on a write.
 * Mirrors the `BriefStatus` wire type in `../api/schema.ts`; surfacing
 * the literal set here means the model reads the enum directly off the
 * recipe schema (and bad values fail at parse-time, not push-time).
 *
 * `InReview` is the wire form for the "In Review" UI label.
 */
export const BriefInstanceStatusSchema = z
  .enum(["Draft", "InReview", "Approved", "Canceled", "Archived"])
  .describe(
    'Brief workflow status. Wire form — "InReview" is the "In Review" UI label. A brief must leave "Draft" before it can be linked to a campaign.'
  );

/**
 * Field values on a brief instance, keyed by `BriefField.name`. The
 * per-field shape varies by field `type` on the brief's type (RichText
 * values are ProseMirror docs; DateTime is an ISO string; Timeline and
 * Budget carry their own object shape). The shape is left as
 * `z.unknown()` so any field type round-trips losslessly between
 * `recipe pull` and `recipe push` without the recipe schema chasing
 * the per-field encoding. Validation is deferred to the server.
 */
export const BriefInstanceFieldsSchema = z
  .record(z.string(), z.unknown())
  .default({})
  .describe(
    "Field values keyed by BriefField.name. Per-field value shape follows the brief type's field definitions (e.g. RichText is a ProseMirror doc node)."
  );

/** The full brief-instance recipe. */
export const BriefInstanceRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Display name of the brief. Identifies the brief when pushing. Briefs are matched by name; the recipe pushes through to `createBrief` / `updateBrief`."
    ),
  briefTypeName: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z][A-Za-z0-9_]*$/,
      "Must start with a letter and contain only letters, digits, or underscores."
    )
    .describe(
      "Codename of the brief type this brief is built against — looked up at push-time and resolved to its server id. The brief type must already exist (push the type's recipe first if it doesn't)."
    ),
  locale: z
    .string()
    .optional()
    .describe('Brief locale — BCP-47-ish, e.g. "en-us". Omit to let the server default apply.'),
  status: BriefInstanceStatusSchema.optional().describe(
    'Brief workflow status. Omit to leave at the server default ("Draft" on creation).'
  ),
  isTemplate: z
    .boolean()
    .optional()
    .describe("Whether the brief is a template (omit to leave at the server default)."),
  fields: BriefInstanceFieldsSchema,
});

/** A validated brief-instance recipe. */
export type BriefInstanceRecipe = z.infer<typeof BriefInstanceRecipeSchema>;
