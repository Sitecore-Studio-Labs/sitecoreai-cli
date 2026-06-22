/**
 * Schema-only agents entry — the agent recipe Zod schemas with a zod-only
 * module graph. None of the `./index` barrel's kind registration, sync, or
 * MCP wiring is pulled (those modules import `@/sync`, `@/shared/errors`, …).
 *
 * Each `src/agents/recipe/*.schema.ts` imports only `zod`, so this entry stays
 * clean. Mirrors the `./recipe/schema` + brief/brand/campaign `schema-only`
 * pattern, and is surfaced as the `agentsSchema` namespace on `./unstable`.
 */

export * from "./agent.schema";
export * from "./custom-mcp.schema";
export * from "./html-template.schema";
export * from "./schema.schema";
export * from "./skill.schema";
export * from "./widget.schema";
