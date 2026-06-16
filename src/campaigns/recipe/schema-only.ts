/**
 * Schema-only campaigns entry —
 * `import { ... } from "@sitecoreai-labs/sitecoreai-cli/unstable/campaigns/schema"`.
 *
 * Re-exports ONLY the campaign recipe Zod schemas (`CampaignRecipeSchema` and
 * its task/deliverable sub-shapes) with a zod-only module graph — none of the
 * `/unstable/campaigns` barrel's API clients, auth, or sync logic.
 *
 * `src/campaigns/recipe/schema.ts` imports only `zod`, so this entry stays
 * clean. Mirrors the `./recipe/schema` pattern.
 */

export * from "./schema";
