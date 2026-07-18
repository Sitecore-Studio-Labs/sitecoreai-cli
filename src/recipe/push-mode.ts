/**
 * Recipe-push failure policy, resolved from `SITECOREAI_RECIPE_PUSH_MODE`.
 *
 * - `strict` (default): the first apply-time op error aborts the recipe,
 *   rolls back everything it applied, and the push exits non-zero
 *   (`DEPLOY_FAILED`). A missing field or a dead media URL fails the whole
 *   install loudly so the underlying content defect gets fixed — the mode
 *   to develop against.
 * - `tolerant`: an apply-time op error is recorded and surfaced (the per-op
 *   `apply-error` event + the command's warning summary) but is NON-fatal —
 *   the executor skips just that op and continues, nothing rolls back, and
 *   the push exits 0. Lets an install complete past external flakiness
 *   (media 5xx) or a known generated-content defect instead of aborting the
 *   whole batch.
 *
 * Cancellation aborts and three-way-merge conflicts are unaffected —
 * tolerant only downgrades apply-time OP errors, never those.
 *
 * The push task reads this once and forwards it to the executor as
 * `ExecuteOptions.onError`; the `recipe push` command reads the same value
 * to decide whether op errors escalate to a non-zero exit code, so both
 * ends agree without threading a flag through every layer.
 */
export type RecipePushMode = "strict" | "tolerant";

/** `strict` unless `SITECOREAI_RECIPE_PUSH_MODE=tolerant` (case-insensitive). */
export const resolveRecipePushMode = (): RecipePushMode =>
  process.env.SITECOREAI_RECIPE_PUSH_MODE?.trim().toLowerCase() === "tolerant"
    ? "tolerant"
    : "strict";

/** Map the resolved push mode to the executor's `onError` policy. */
export const resolveRecipePushOnError = (): "abort" | "continue" =>
  resolveRecipePushMode() === "tolerant" ? "continue" : "abort";
