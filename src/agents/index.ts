/**
 * Public entry for the Sitecore **Agentic Studio** area.
 *
 * Agentic Studio is Sitecore AI's agent builder. This area seeds agents,
 * triggers runs, and reads the catalogs they draw on. Its BFF is gated by
 * a browser session cookie, so auth runs through the `session/` seam
 * rather than scai's usual client-credentials OAuth — a deliberate
 * stopgap. Every unverified write in this area is gated behind
 * `--unverified`.
 *
 * A session comes from one of three sources, all converging on the same
 * `AgentsSession`:
 *   - `loginAgents`            — Playwright browser login (the CLI path)
 *   - `agentsSessionFromCookie`— direct cookie injection (embedded UI)
 *   - a bearer token           — once Sitecore opens the product up
 */

export * from "./session";
export { agentsRequest, agentsStream } from "./api/request";
export * from "./api/schema";
export * from "./api/agents";
export * from "./api/skills";
export * from "./api/tools";
export * from "./api/widgets";
export * from "./api/custom-mcps";
export * from "./api/schemas";
export * from "./api/html-templates";
export * from "./api/spaces";
export * from "./api/runs";
export * from "./api/catalog";
export * from "./recipe";
export {
  resolveAgentsSession,
  type ResolveAgentsSessionOptions,
  type ResolvedAgentsSession,
} from "./client";
