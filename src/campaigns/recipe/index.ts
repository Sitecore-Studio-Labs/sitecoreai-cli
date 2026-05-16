/**
 * The `campaign` recipe kind — declarative definition + `sync` support
 * for Sitecore Orchestrate campaigns (projects, deliverables, tasks).
 *
 * See docs/recipe-sync-architecture.md.
 */
export {
  CampaignRecipeSchema,
  CampaignDeliverableSchema,
  CampaignTaskSchema,
  type CampaignRecipe,
  type CampaignDeliverable,
  type CampaignTask,
} from "./schema";
export { diffCampaign } from "./diff";
export { resolveCampaignClient } from "./client";
export { campaignKind } from "./kind";
