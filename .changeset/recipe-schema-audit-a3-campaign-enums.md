---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Recipe schema audit Tier A3: campaign server-enum fields now use
`z.union([z.enum(KNOWN_*), z.string()])` instead of bare `z.string()`,
so AI authors get the observed values as a strong hint without
breaking `recipe pull` when the API returns an unobserved enum
value.

- `CampaignTask.status` / `CampaignDeliverable.status` /
  `CampaignRecipe.status` accept `KNOWN_CAMPAIGN_STATUSES` =
  `["NOT_STARTED"]` plus any other string.
- `CampaignDeliverable.funnelStage` accepts
  `KNOWN_CAMPAIGN_FUNNEL_STAGES` = `["TOP"]` plus any other string.
- `KNOWN_CAMPAIGN_STATUSES` and `KNOWN_CAMPAIGN_FUNNEL_STAGES` are
  exported from `src/campaigns/recipe/schema.ts` — extend them as
  more enum values are observed in HAR captures.
- `Task.priority` stays `z.string()` until any priority values are
  observed in capture.

JSON Schema renders these as `anyOf: [{ enum: [...] }, { type:
"string" }]` so Agent Studio gets the confirmed set surfaced
first while remaining schema-valid against unobserved values.
