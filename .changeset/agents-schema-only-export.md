---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(agents): export an `agentsSchema` namespace on `./unstable`

Adds `src/agents/recipe/schema-only.ts` (a zod-only re-export of the agent
recipe schemas) and surfaces it as the `agentsSchema` namespace on `./unstable`,
bringing agents to parity with `briefSchema` / `brandSchema` / `campaignsSchema`.
