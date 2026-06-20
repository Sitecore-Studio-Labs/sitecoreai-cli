/**
 * `CampaignRecipe` — the declarative definition of a Sitecore
 * Orchestrate campaign (a `project`, with its nested deliverables and
 * tasks).
 *
 * This schema is the single source of truth for the `campaign` recipe
 * kind: it validates recipe files, drives the `sync` CLI, and becomes
 * the MCP tool input schema. Keep the `.describe()` text accurate — the
 * model reads it. See docs/recipe-sync-architecture.md.
 */
import { z } from "zod";

/**
 * ISO-8601 date-or-datetime — accepts `2026-05-26`, `2026-05-26T15:00:00Z`,
 * or `2026-05-26T15:00:00.123+02:00`. Less strict than `z.string().datetime()`
 * because the campaign API returns date-only values for some fields.
 */
const Iso8601 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2}))?$/, {
    message: "must be an ISO-8601 date or datetime (e.g. `2026-05-26` or `2026-05-26T15:00:00Z`)",
  });

/**
 * Server enum values **confirmed by observation** in HAR captures of the
 * Sitecore Content Operations UI driving the Orchestrate API. Other
 * values likely exist in the server's enum — `recipe pull` from a tenant
 * with a live `IN_PROGRESS` campaign must still round-trip cleanly — so
 * the schema accepts the known set as a strong hint and falls back to
 * `z.string()`. JSON Schema renders this as `anyOf: [{ enum: [...] }, { type:
 * "string" }]`, which the model reads as "prefer one of these values; new
 * uppercase enums are acceptable too".
 *
 * Update the lists when more values are observed; the trailing
 * `z.string()` keeps the schema permissive in the meantime.
 */
export const KNOWN_CAMPAIGN_STATUSES = ["NOT_STARTED"] as const;
export const KNOWN_CAMPAIGN_FUNNEL_STAGES = ["TOP"] as const;

const CampaignStatusSchema = z.union([z.enum(KNOWN_CAMPAIGN_STATUSES), z.string()]);
const CampaignFunnelStageSchema = z.union([z.enum(KNOWN_CAMPAIGN_FUNNEL_STAGES), z.string()]);

/**
 * A task — the leaf work item of a campaign. Owned by a deliverable.
 * Identified within its deliverable by `name`; server ids are dropped
 * from a captured recipe.
 */
export const CampaignTaskSchema = z.object({
  /**
   * Stable handle for cross-task dependency references. Optional —
   * tasks without a handle can't be referenced by another task's
   * `dependencies` array but otherwise behave identically. Convention
   * is `<kebab-name>@<schemaVersion>` (e.g. `subject-line-ab-test@1`),
   * matching the brief + campaign handle scheme.
   */
  handle: z
    .string()
    .optional()
    .describe(
      "Stable kebab handle (e.g. `subject-line-ab-test@1`) so other tasks can declare a dependency on this one. Optional — only required when this task is referenced as a dependency."
    ),
  /**
   * Sitecore Orchestrate task UUID. When present, the apply path uses
   * it directly instead of paging the project's tasks and matching by
   * `handle:<x>` label. Round-trips through the apply outcome so the
   * orchestrator can persist it back onto the registry recipe.
   */
  sitecoreId: z
    .string()
    .uuid()
    .optional()
    .describe("Sitecore Orchestrate task UUID. Skip-label-search fast path when present."),
  name: z.string().min(1).describe("Task name. Identifies the task within its deliverable."),
  status: CampaignStatusSchema.optional().describe(
    'Task status — a server enum. Confirmed values: "NOT_STARTED". Other UPPER_SNAKE values may exist on the server; the schema accepts them but agents should prefer the confirmed set.'
  ),
  dueDate: Iso8601.optional().describe("Task due date (ISO-8601 date or datetime)."),
  priority: z
    .string()
    .optional()
    .describe(
      "Task priority — a server enum. No values have been observed yet; convention follows project-management norms (e.g. UPPERCASE strings). Schema is `string` until the enum set is captured."
    ),
  description: z.string().optional().describe("Task description. HTML."),
  assignee: z.string().optional().describe('Assignee — an Auth0 user subject (e.g. "auth0|...").'),
  labels: z.array(z.string()).default([]).describe("Free-form labels on the task."),
  /**
   * Tasks this one depends on, referenced by their `handle`. The
   * orchestrator resolves handles to server UUIDs in a second push
   * pass after all tasks are created — dependencies CAN reference
   * tasks in sibling deliverables under the same project (the wire
   * accepts cross-deliverable refs because each dep entry carries
   * the full `{project_id, project_deliverable_id, task_id}` triple).
   */
  dependencies: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Handles of tasks this task depends on. Resolved to server UUIDs at push time. Cross-deliverable references are supported as long as both tasks belong to the same campaign."
    ),
});

/**
 * A deliverable — a funnel-stage grouping of tasks under a campaign.
 * Matched within its campaign by `handle` (stamped into the wire's
 * `labels` array as `handle:<handle>`) when present, falling back to
 * `name`. Stable handles keep re-syncs idempotent even when the LLM
 * picks different display names between story regenerates.
 */
export const CampaignDeliverableSchema = z.object({
  /**
   * Stable kebab handle (e.g. `top-funnel-creative@1`). Apply stamps
   * `handle:<handle>` into the deliverable's `labels` so re-pushes
   * match by label rather than by the volatile display name. Optional
   * but strongly recommended for generator-produced deliverables.
   */
  handle: z
    .string()
    .optional()
    .describe(
      "Stable kebab handle. Stamped into the wire `labels` array as `handle:<handle>` so re-pushes match by label rather than by the LLM-volatile display name."
    ),
  /**
   * Sitecore Orchestrate deliverable UUID. When present, the apply
   * path uses it directly instead of paging the project's
   * deliverables and matching by `handle:<x>` label.
   */
  sitecoreId: z
    .string()
    .uuid()
    .optional()
    .describe("Sitecore Orchestrate deliverable UUID. Skip-label-search fast path when present."),
  name: z
    .string()
    .min(1)
    .describe("Deliverable name. Identifies the deliverable within its campaign."),
  status: CampaignStatusSchema.optional().describe(
    'Deliverable status — a server enum. Confirmed values: "NOT_STARTED". Other UPPER_SNAKE values may exist on the server; the schema accepts them but agents should prefer the confirmed set.'
  ),
  dueDate: Iso8601.optional().describe("Deliverable due date (ISO-8601 date or datetime)."),
  funnelStage: CampaignFunnelStageSchema.optional().describe(
    'Funnel stage — a server enum. Confirmed values: "TOP". Other values likely exist (e.g. middle / bottom of funnel); the schema accepts them but agents should prefer the confirmed set.'
  ),
  funnelTactics: z.array(z.string()).default([]).describe("Funnel tactics for the deliverable."),
  labels: z.array(z.string()).default([]).describe("Free-form labels on the deliverable."),
  tasks: z
    .array(CampaignTaskSchema)
    .default([])
    .describe(
      "Tasks under this deliverable. On push, missing tasks are created and existing ones converged."
    ),
});

/**
 * A campaign member — a tenant user attached to the project with a
 * role. Verified roles (TestDemo 2026-06-03): `ADMIN`, `EDITOR`,
 * `VIEWER`, `MEMBER`. The `role` field is omittable; the server
 * default behaviour is captured in the project's UI permissions
 * model and not yet documented here.
 */
export const CampaignMemberSchema = z
  .object({
    authorId: z
      .string()
      .min(1)
      .describe(
        "Auth0 subject of the tenant user (e.g. `auth0|<sub>`). Use `scai ops campaign users list` to enumerate the tenant directory."
      ),
    role: z
      .enum(["ADMIN", "EDITOR", "VIEWER", "MEMBER"])
      .optional()
      .describe(
        "Role on the project. ADMIN can add other members + delete the project; EDITOR can edit content but not membership; VIEWER reads only; MEMBER is the unprivileged default."
      ),
  })
  .describe("One member on a campaign (project).");

/** The full campaign recipe — a project plus its nested deliverables. */
export const CampaignRecipeSchema = z.object({
  /**
   * Stable kebab handle (e.g. `spring-refresh-bundle-save@1`) used as
   * the baseline key + cross-recipe reference target. Display names
   * (`name`) can include arbitrary punctuation that breaks URL paths
   * — handles are URL-safe by convention.
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
      "Stable kebab handle (e.g. `spring-refresh-bundle-save@1`). When set, used as the baseline key — URL-safe by construction. Falls back to `name` when absent (back-compat)."
    ),
  /**
   * Sitecore Orchestrate project UUID. When set on input, the sync
   * commands stamp it into `KindRef.tenantId` so `readCurrent` can
   * skip the label/name search and read the project directly.
   */
  sitecoreId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Sitecore Orchestrate project UUID. When set, scai's apply path skips the label search and reads the project by id directly."
    ),
  name: z
    .string()
    .min(1)
    .describe("Display name of the campaign (project). Identifies the campaign when pushing."),
  description: z.string().optional().describe("Human description of the campaign."),
  status: CampaignStatusSchema.optional().describe(
    'Campaign status — a server enum. Confirmed values: "NOT_STARTED". Other UPPER_SNAKE values may exist on the server; the schema accepts them but agents should prefer the confirmed set.'
  ),
  startDate: Iso8601.optional().describe("Campaign start date (ISO-8601 date or datetime)."),
  dueDate: Iso8601.optional().describe("Campaign due date (ISO-8601 date or datetime)."),
  brandKitId: z
    .string()
    .optional()
    .describe("Associated brand kit UUID. A cross-reference, not an embedded object."),
  thumbnailUrl: z
    .string()
    .optional()
    .describe(
      "Campaign icon — the project `thumbnail_url`. The Content Ops UI treats this value as an MMS **mediaId** (the trailing segment of the file's `mms-delivery` URL) and fetches the bytes from MMS to render the icon, so a plain image URL will NOT render. Producing a viewable mediaId needs the MMS upload flow (scope `mms.upload.file:add`), which scai's M2M credentials lack — set this to an existing MMS mediaId."
    ),
  labels: z.array(z.string()).default([]).describe("Free-form labels on the campaign."),
  /**
   * Members on the project. `apply` enforces an ADMIN-present
   * invariant — if no entry carries `role: "ADMIN"`, the first
   * member is promoted to ADMIN before push. This guards against
   * a service-account-only project (which leaves the project
   * unusable in the Orchestrate UI because the actual humans
   * have no permission to see or edit it).
   */
  members: z
    .array(CampaignMemberSchema)
    .default([])
    .describe(
      "Project members keyed by Auth0 sub. Each entry POSTs to /projects/{id}/members after the project is created. The apply path ensures at least one member is ADMIN."
    ),
  deliverables: z
    .array(CampaignDeliverableSchema)
    .default([])
    .describe(
      "Deliverables under the campaign. On push, missing deliverables (and their tasks) are created; existing tasks are converged."
    ),
});

/** A validated campaign recipe. */
export type CampaignRecipe = z.infer<typeof CampaignRecipeSchema>;

/** A deliverable within a campaign recipe. */
export type CampaignDeliverable = z.infer<typeof CampaignDeliverableSchema>;

/** A task within a campaign recipe. */
export type CampaignTask = z.infer<typeof CampaignTaskSchema>;
