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
 * A task — the leaf work item of a campaign. Owned by a deliverable.
 * Identified within its deliverable by `name`; server ids are dropped
 * from a captured recipe.
 */
export const CampaignTaskSchema = z.object({
  name: z.string().min(1).describe("Task name. Identifies the task within its deliverable."),
  status: z.string().optional().describe('Task status — a server enum, e.g. "NOT_STARTED".'),
  dueDate: Iso8601.optional().describe("Task due date (ISO-8601 date or datetime)."),
  priority: z.string().optional().describe("Task priority — a server enum."),
  description: z.string().optional().describe("Task description. HTML."),
  assignee: z.string().optional().describe('Assignee — an Auth0 user subject (e.g. "auth0|...").'),
  labels: z.array(z.string()).default([]).describe("Free-form labels on the task."),
});

/**
 * A deliverable — a funnel-stage grouping of tasks under a campaign.
 * Identified within its campaign by `name`.
 */
export const CampaignDeliverableSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Deliverable name. Identifies the deliverable within its campaign."),
  status: z.string().optional().describe('Deliverable status — a server enum, e.g. "NOT_STARTED".'),
  dueDate: Iso8601.optional().describe("Deliverable due date (ISO-8601 date or datetime)."),
  funnelStage: z.string().optional().describe('Funnel stage — a server enum, e.g. "TOP".'),
  funnelTactics: z.array(z.string()).default([]).describe("Funnel tactics for the deliverable."),
  labels: z.array(z.string()).default([]).describe("Free-form labels on the deliverable."),
  tasks: z
    .array(CampaignTaskSchema)
    .default([])
    .describe(
      "Tasks under this deliverable. On push, missing tasks are created and existing ones converged."
    ),
});

/** The full campaign recipe — a project plus its nested deliverables. */
export const CampaignRecipeSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Display name of the campaign (project). Identifies the campaign when pushing."),
  description: z.string().optional().describe("Human description of the campaign."),
  status: z.string().optional().describe('Campaign status — a server enum, e.g. "NOT_STARTED".'),
  startDate: Iso8601.optional().describe("Campaign start date (ISO-8601 date or datetime)."),
  dueDate: Iso8601.optional().describe("Campaign due date (ISO-8601 date or datetime)."),
  brandKitId: z
    .string()
    .optional()
    .describe("Associated brand kit UUID. A cross-reference, not an embedded object."),
  labels: z.array(z.string()).default([]).describe("Free-form labels on the campaign."),
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
