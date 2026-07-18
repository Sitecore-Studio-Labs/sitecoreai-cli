---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(recipe): strict-by-default push with an opt-in tolerant mode (`SITECOREAI_RECIPE_PUSH_MODE`)

Recipe push stays **strict** by default: the first apply-time op error aborts the recipe, rolls back everything it applied, and exits `DEPLOY_FAILED`. A missing field or a dead media URL fails the whole install loudly so the underlying content defect gets fixed.

Set `SITECOREAI_RECIPE_PUSH_MODE=tolerant` to make apply-time op errors non-fatal: the executor skips just the failing op (still surfaced as an `apply-error` event and counted in the per-recipe `error` summary), keeps applying the rest of the recipe, does not roll back, and the push exits 0. This lets an install complete past transient external failures (e.g. a media host returning 502) or a known generated-content defect instead of aborting the whole batch. Cancellation aborts and three-way-merge conflicts still fail in either mode — tolerant only downgrades apply-time op errors.

Plumbed as `ExecuteOptions.onError: "abort" | "continue"`; the `recipe push` command reads the same mode so the exit code matches the executor's behaviour.
