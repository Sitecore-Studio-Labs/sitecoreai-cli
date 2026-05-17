/**
 * Operation risk registry — the single, auditable classification of
 * scai's mutating operations by risk tier (Phase 3).
 *
 * Anything not listed here is `write`. Listing an operation as
 * `destructive` makes `ensureAllowWrite(root, env, override, id)` — and
 * thus every CLI / SDK / MCP path that runs it — authorize at the
 * `destructive` tier: refused for `m2m` / `mcp` callers, and for a `ci`
 * caller without `ciWrites`. See docs/policy-and-guardrails.md.
 *
 * A security reviewer reads this one file to see everything scai treats
 * as irreversible.
 */

import type { RiskTier } from "./types";

/** Stable id of a risk-classified mutating operation. */
export type OperationId =
  | "cleanup-versions-prune"
  | "cleanup-archive-purge"
  | "cleanup-dead-templates"
  | "cleanup-duplicates"
  | "cleanup-subtree"
  | "cleanup-roles"
  | "cleanup-users"
  | "cleanup-site-residue"
  | "recipe-push";

/**
 * Risk tier of each classified operation. Every entry here is currently
 * `destructive` (irreversible); the `RiskTier` value type leaves room to
 * classify an operation at another tier later without a shape change.
 */
export const OPERATION_RISK: Record<OperationId, RiskTier> = {
  "cleanup-versions-prune": "destructive",
  "cleanup-archive-purge": "destructive",
  "cleanup-dead-templates": "destructive",
  "cleanup-duplicates": "destructive",
  "cleanup-subtree": "destructive",
  "cleanup-roles": "destructive",
  "cleanup-users": "destructive",
  "cleanup-site-residue": "destructive",
  "recipe-push": "destructive",
};

/** The risk tier of an operation. */
export const riskTierForOperation = (operation: OperationId): RiskTier => OPERATION_RISK[operation];
