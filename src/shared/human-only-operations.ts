/**
 * Operations scai categorically refuses for non-human callers.
 *
 * Credential provisioning either runs an interactive browser flow or is
 * gated to interactive-human callers by the workspace policy — an agent,
 * MCP server, or CI process cannot perform them. Declared here as a
 * single source of truth so an agent learns a step needs a human
 * *before* attempting it, rather than discovering it through a refusal.
 *
 * Surfaced by the MCP `scai_overview` tool and the `access_check`
 * preflight, and described in prose by the `scai://help/access-and-policy`
 * resource. `shared/` is a leaf — this module is pure data, no imports.
 */

/** A scai operation only an interactive human, at a real terminal, can perform. */
export interface HumanOnlyOperation {
  /** Stable identifier. */
  id: string;
  /** The CLI command a human runs, in a real terminal. */
  command: string;
  /** Why it cannot be performed by an agent / CI / MCP caller. */
  reason: string;
}

/**
 * The complete set of human-terminal-only operations. Keep in sync with
 * the `needs-human-terminal` remediation sites — these are the only
 * operations that emit that `RemediationActor`.
 */
export const HUMAN_ONLY_OPERATIONS: readonly HumanOnlyOperation[] = [
  {
    id: "device-login",
    command: "scai setup login -n <env>",
    reason:
      "Interactive browser device-login flow — hard-fails without a TTY, and an agent's shell is not a TTY.",
  },
  {
    id: "mint-automation-client",
    command: "scai setup client create <env>",
    reason:
      "The workspace policy gates credential minting to interactive-human callers; agents, CI, and MCP processes are refused as 'm2m'.",
  },
] as const;
