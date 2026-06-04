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

/**
 * One to-do on a brief. The Brief API exposes a minimal task surface —
 * the persisted record carries only `title`, `status` (locked to
 * `Pending` on create), and `assignees`. Probing TestDemo 2026-06-03
 * confirmed that `description`, `body`, `dueDate`, and `DueOn` are
 * silently dropped by the server, so they're not in the recipe.
 *
 * Round-trip: `apply` POSTs each todo to `/api/brief/v1/tasks` after
 * the brief is created/updated. The pull projection lists tasks
 * filtered by `BriefId` and rebuilds the array from response order.
 */
export const BriefTodoSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe(
        "Short verb phrase shown in the brief's to-do list. The only text the Brief API persists on a task — no description field exists."
      ),
    assigneeIds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Auth0 subjects (e.g. `auth0|<sub>`) assigned to the to-do. Use `scai ops campaign users list` to enumerate the tenant's member directory."
      ),
  })
  .describe("One to-do on a brief.");

/**
 * One comment on a brief. The Brief API stores comments with an
 * impersonated `author` (the Auth0 sub passed in `authorId`) while
 * `createdBy` independently captures the calling client — letting
 * automation post on behalf of named users (CSM, Designer, Legal,
 * etc.) without conflating the audit trail.
 *
 * `text` accepts a plain string OR a ProseMirror doc node; the
 * server persists either as a RichText envelope. The seed
 * generator emits ProseMirror so formatting (bold, links, lists)
 * survives the round-trip into the brief's comment thread.
 */
export const BriefCommentSchema = z
  .object({
    text: z
      .union([z.string().min(1), z.record(z.string(), z.unknown())])
      .describe(
        "Comment body. Plain string OR ProseMirror doc node. ProseMirror preserves marks (bold, italic, links) — the seed generator emits PM for formatted comments."
      ),
    authorId: z
      .string()
      .min(1)
      .describe(
        "Auth0 subject of the visible comment author (e.g. `auth0|<sub>`). Use `scai ops campaign users list` to enumerate. Required — the Brief API rejects POSTs without an authorId."
      ),
  })
  .describe("One comment on a brief.");

/**
 * Cross-resource reference attached to a brief. Sitecore Brief API
 * persists these in the `references` array on a read; verified
 * 2026-06-03 that `PUT /api/brief/v1/briefs/{id}` with a `references`
 * field on the body accepts the same shape and persists it.
 *
 * The most common use is linking a brief to its parent Orchestrate
 * project (campaign) — `relatedSystem: "co"`, `relatedType: "Project"`,
 * `id: <projectId>`. Other related-system slugs (e.g. `xmcloud`)
 * appear on read but their write semantics are unverified.
 */
export const BriefExternalReferenceSchema = z
  .object({
    type: z.literal("ExternalLink").describe('Discriminator. Always "ExternalLink" today.'),
    relatedSystem: z
      .string()
      .min(1)
      .describe(
        "Sibling system slug — `co` for Sitecore Orchestrate (campaigns/projects), `xmcloud` for XM Cloud content. Verified for `co`; others unverified."
      ),
    relatedType: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Resource type within the `relatedSystem`, e.g. `Project` for an Orchestrate campaign. `null` is accepted."
      ),
    id: z
      .string()
      .min(1)
      .describe(
        "Foreign identifier — a UUID for an Orchestrate project, an Auth0 sub for an `xmcloud` user, etc."
      ),
  })
  .describe(
    "One external reference attached to a brief. Linking a brief to its parent campaign uses {type: ExternalLink, relatedSystem: 'co', relatedType: 'Project', id: <projectId>}."
  );

/** The full brief-instance recipe. */
export const BriefInstanceRecipeSchema = z.object({
  /**
   * Stable kebab handle (e.g. `concept-review-brief@1`) used as the
   * baseline key. Display names (`name`) can include arbitrary
   * punctuation that breaks URL paths — handles are URL-safe by
   * convention.
   *
   * Optional for back-compat with recipes authored before this field
   * existed. When absent, the baseline key falls back to the display
   * name; pushes from agentic flows (registry + orchestrator) should
   * always set it explicitly.
   */
  handle: z
    .string()
    .optional()
    .describe(
      "Stable kebab handle (e.g. `concept-review-brief@1`). When set, used as the baseline key — URL-safe by construction. Falls back to `name` when absent (back-compat)."
    ),
  /**
   * Sitecore Brief UUID. When set on input, the sync commands stamp
   * it into `KindRef.tenantId` so `readCurrent` skips the marker-in-
   * name search and reads the brief by id directly. Retires the
   * `[story:X/handle@1]` suffix once every brief has been stamped.
   */
  sitecoreId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Sitecore Brief UUID. When set, scai's apply path reads the brief by id directly — skipping the marker-in-name fallback."
    ),
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
  todos: z
    .array(BriefTodoSchema)
    .optional()
    .describe(
      "To-dos attached to the brief. Full-replace semantics on apply: scai lists the brief's existing tasks, compares canonical signatures (sorted titles + sorted assigneeIds), and when they differ deletes all existing and POSTs the recipe's array fresh. Equal signatures no-op. Omitting the field entirely leaves tenant tasks untouched (back-compat); `todos: []` explicitly clears the list. Round-trips on `pull` via `listBriefTasks` with `MetadataToLoad=assignees`. See `BriefTodoSchema` for the persisted-field set."
    ),
  comments: z
    .array(BriefCommentSchema)
    .optional()
    .describe(
      "Comments attached to the brief — POSTed to `/api/brief/v1/comments` after the brief is created/updated. Create-only for now. Each comment carries its own `authorId` so a single push can populate a multi-person conversation. See `BriefCommentSchema` for the field set and impersonation semantics."
    ),
  references: z
    .array(BriefExternalReferenceSchema)
    .optional()
    .describe(
      "External resource references — linking a brief to its parent Orchestrate project (campaign) is the verified case: `{type: ExternalLink, relatedSystem: 'co', relatedType: 'Project', id: <projectId>}`. Applied via a follow-up `PUT /api/brief/v1/briefs/{id}` after the brief is created."
    ),
  campaignHandle: z
    .string()
    .optional()
    .describe(
      "Stable handle of the parent Orchestrate campaign (project). When set, scai's apply path resolves it to a project id via list-by-labels (`story:<storyId>` + `handle:<campaignHandle>`) and PUTs the resolved ExternalLink onto the brief's references. The campaign must already exist on the tenant — story-sync pushes campaigns before briefs."
    ),
  storyId: z
    .string()
    .optional()
    .describe(
      "Story UUID. Narrows campaign-handle resolution by the `story:<id>` label so two stories that share a campaign handle don't collide. Omittable when `campaignHandle` is also omitted."
    ),
});

/** A validated brief-instance recipe. */
export type BriefInstanceRecipe = z.infer<typeof BriefInstanceRecipeSchema>;
