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

/**
 * One milestone on a brief's evaluation timeline — a workflow gate the
 * brief progresses through (concept review, draft delivered, final
 * approved, paid-media live, etc.).
 *
 * Distinct from the `Timeline` brief-type field type (single
 * start/end schedule). Milestones are universal across all brief
 * types: every brief has an evaluation timeline regardless of its
 * type-level field configuration.
 *
 * **Sitecore round-trip caveat**: the Brief API doesn't currently
 * expose a native milestone-array surface. scai's `briefInstanceKind`
 * does NOT serialize this field into the Sitecore push body, and
 * `briefInstanceKind.readCurrent` does NOT read it back. Milestones
 * round-trip cleanly between recipe push and recipe pull of the same
 * recipe file (via the schema's structural identity) but get lost on
 * Sitecore round-trips. When the Brief API exposes a milestone field
 * (or we pick an encoding inside `fields`), the writer will fill it
 * in and the projection will read it.
 */
export const BriefMilestoneSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .describe(
        'Milestone name — short verb phrase, e.g. "Concept Review", "Draft Delivered", "Final Approved", "Paid Media Live".'
      ),
    dueDate: z
      .string()
      .optional()
      .describe(
        "When the milestone is due (ISO-8601 date or datetime). Omitted milestones default to the brief's overall dueDate at render time."
      ),
    status: z
      .enum(["not-started", "in-progress", "completed", "missed"])
      .optional()
      .describe(
        "Milestone state. `not-started` is the default for future-dated milestones. Seed generators set this realistically from the dueDate (past-due → mostly `completed` with 1-2 late; close-present → mix of `completed` + `in-progress`; far-future → `not-started`)."
      ),
    description: z
      .string()
      .optional()
      .describe(
        "What this milestone represents (acceptance criteria, deliverable expected). Short — one or two sentences."
      ),
    completedAt: z
      .string()
      .optional()
      .describe(
        'When the milestone was actually completed (ISO-8601). Set together with `status: "completed"`.'
      ),
  })
  .describe("One workflow milestone on a brief's evaluation timeline.");

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
  evaluationTimeline: z
    .array(BriefMilestoneSchema)
    .optional()
    .describe(
      "Workflow milestones (concept review, draft delivered, final approved, etc.). Top-level — not inside `fields`. Currently recipe-local: the Sitecore Brief API has no native milestone surface, so this field round-trips through `recipe push` / `recipe pull` of the same recipe file but isn't serialized to Sitecore on apply or projected back on capture. See `BriefMilestoneSchema` for the per-entry shape + the round-trip caveat."
    ),
});

/** A validated brief-instance recipe. */
export type BriefInstanceRecipe = z.infer<typeof BriefInstanceRecipeSchema>;
