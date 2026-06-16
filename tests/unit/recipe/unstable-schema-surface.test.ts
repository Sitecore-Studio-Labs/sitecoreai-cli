import { describe, expect, it } from "vitest";
import * as brandSchema from "../../../src/brand/recipe/schema-only";
import * as briefSchema from "../../../src/brief/recipe/schema-only";
import * as campaignSchema from "../../../src/campaigns/recipe/schema-only";

/**
 * Pin the schema-only family entries
 * (`@sitecoreai-labs/sitecoreai-cli/unstable/{brand,brief,campaigns}/schema`).
 *
 * Each must expose its recipe schemas AND must NOT leak the family barrel's
 * API-client / auth surface — that absence is the whole point: schema-only
 * consumers (e.g. a frontend re-exporting these into client-reachable code)
 * import here precisely so the HTTP + auth machinery never enters their graph.
 */
const CLIENT_PREFIX = /^(list|get|create|update|delete|acquire|run|request|resolve)/;

describe("schema-only family entries", () => {
  it("/unstable/brand/schema exposes BrandKitRecipeSchema, no clients", () => {
    expect(brandSchema.BrandKitRecipeSchema).toBeDefined();
    expect(typeof brandSchema.BrandKitRecipeSchema.safeParse).toBe("function");
    expect(Object.keys(brandSchema).filter((k) => CLIENT_PREFIX.test(k))).toEqual([]);
  });

  it("/unstable/brief/schema exposes BriefType + BriefInstance schemas, no clients", () => {
    expect(briefSchema.BriefTypeRecipeSchema).toBeDefined();
    expect(briefSchema.BriefInstanceRecipeSchema).toBeDefined();
    expect(Object.keys(briefSchema).filter((k) => CLIENT_PREFIX.test(k))).toEqual([]);
  });

  it("/unstable/campaigns/schema exposes CampaignRecipeSchema, no clients", () => {
    expect(campaignSchema.CampaignRecipeSchema).toBeDefined();
    expect(typeof campaignSchema.CampaignRecipeSchema.safeParse).toBe("function");
    expect(Object.keys(campaignSchema).filter((k) => CLIENT_PREFIX.test(k))).toEqual([]);
  });
});
