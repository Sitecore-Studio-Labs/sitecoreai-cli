/**
 * Agentic Studio session resolution — env profile lookup paired with the
 * keychain-backed session loader.
 *
 * This is the orchestration the CLI runners (`./tasks`) share. It is
 * exported from the area barrel so an SDK consumer can obtain a session
 * for a configured environment in one call rather than re-deriving the
 * env name. `acquireAgentsSession` (the raw loader), `loginAgents`, and
 * `agentsSessionFromCookie` remain available for callers that bring
 * their own environment or session source.
 *
 * Presentation-free: no logger, no stdout, no `process.exit`.
 */
import { resolveEnvironment } from "@/shared/env";
import { acquireAgentsSession } from "./session";
import type { AgentsSession } from "./session/types";

/** Options for {@link resolveAgentsSession}. */
export interface ResolveAgentsSessionOptions {
  /** Environment profile name; defaults to the configured default env. */
  environmentName?: string;
  /** Base directory for resolving `sitecoreai.cli.json`; defaults to cwd. */
  config?: string;
}

/** A resolved Agentic Studio session plus the environment it is bound to. */
export interface ResolvedAgentsSession {
  session: AgentsSession;
  envName: string;
}

/**
 * Resolve an Agentic Studio session for an environment — env profile
 * lookup, then the keychain-backed session load.
 */
export const resolveAgentsSession = async (
  options: ResolveAgentsSessionOptions = {}
): Promise<ResolvedAgentsSession> => {
  const { envName } = resolveEnvironment(options);
  const session = await acquireAgentsSession(envName);
  return { session, envName };
};
