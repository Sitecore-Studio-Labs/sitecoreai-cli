import { runRecipePush } from "./push";
import type { ExecutionResult } from "../execute";
import type { RecipePushOptions } from "./shared";

/**
 * `scai recipe diff` — read-only "what would change" against a tenant.
 *
 * Drives the same input resolution, in-memory compile, and planner
 * as `recipe push`, but read-only by construction: `whatIf` is forced
 * on, `allowWrite` is ignored (no `ensureAllowWrite` gate fires
 * because dry-run mode skips it), and no Sites API job ever dispatches.
 *
 * Operators reach for `diff` when reviewing a change set; reach for
 * `recipe push --what-if` when they're about to apply and want a
 * last-look. Same output, different framing.
 */
export type RecipeDiffOptions = Omit<RecipePushOptions, "whatIf" | "allowWrite">;

export const runRecipeDiff = async (options: RecipeDiffOptions): Promise<ExecutionResult[]> =>
  runRecipePush({ ...options, whatIf: true });
