import type { WebhookAuthorizationRecipe } from "@/recipe/schema/recipe";

/**
 * Example: a reusable webhook authorization that workflow webhooks and
 * event handlers reference by handle. Secrets are by `$ENV:` reference —
 * the CLI resolves at apply time. Compile-only flows (`recipe diff`,
 * `recipe push --what-if`) don't need the env var set.
 *
 * Authorization types + token-handling: docs/recipes/workflow.md#authorization-types
 */
export const ciBearerAuth = {
  kind: "webhook-authorization",
  schemaVersion: "1",
  handle: "ci-bearer@1",
  name: "CI Bearer",
  displayName: "CI Bearer Token",
  description: "Token used by CI to authenticate workflow + publish webhooks.",
  auth: {
    type: "ApiKey",
    headerName: "Authorization",
    key: "$ENV:CI_WEBHOOK_TOKEN",
  },
} satisfies WebhookAuthorizationRecipe;
