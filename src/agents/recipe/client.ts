/**
 * Resolves an `AgentsSession` from a `SyncContext` — the bridge between
 * the generic `sync` engine and the Agentic Studio BFF.
 *
 * Unlike the campaign/brand resolvers (which mint an OAuth token), this
 * loads the keychain-backed browser session captured by `scai agents
 * login`. No session → `acquireAgentsSession` throws `AUTH_REQUIRED`.
 */
import { acquireAgentsSession } from "../session";
import type { AgentsSession } from "../session/types";
import type { SyncContext } from "@/sync";

/** Build the Agentic Studio session for the context's environment. */
export const resolveAgentsSession = (ctx: SyncContext): Promise<AgentsSession> =>
  acquireAgentsSession(ctx.environmentName);
