/**
 * `scai agents …` task runners — barrel.
 *
 * Runners are split by area: `shared` (env + session + rendering
 * plumbing), `session` (login / logout / status), `agent` (agent CRUD +
 * run), and `resources` (the shared skill / widget / schema / mcp /
 * html-template / tool tasks). `@/agents/tasks` re-exports them all so
 * command modules import from a single path.
 */
export * from "./shared";
export * from "./session";
export * from "./agent";
export * from "./resources";
export * from "./space";
