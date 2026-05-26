/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/webhooks`.
 *
 * Sitecore webhooks (event handlers + workflow submit/validation actions)
 * authored against the Authoring GraphQL API. Surface mirrors the
 * `scai content workflow webhook *` command tree.
 */

export {
  createWebhookApiClient,
  type WebhookApiClient,
  type WebhookClientOptions,
  type WebhookHandlerSummary,
  type WebhookHandlerDetail,
  type WebhookHandlerFieldsMap,
  type WebhookSerializationType,
  type CreateEventHandlerInput,
  type CreateWorkflowActionInput,
  type WebhookEventTypeCategory,
  type WebhookEventTypeSummary,
  DEFAULT_WEBHOOK_HANDLERS_ROOT,
  WEBHOOK_FIELD_DESCRIPTION,
  WEBHOOK_FIELD_URL,
  WEBHOOK_FIELD_EVENTS,
  WEBHOOK_FIELD_ENABLED,
  WEBHOOK_FIELD_AUTHORIZATION,
  WEBHOOK_FIELD_SERIALIZATION_TYPE,
} from "./api/client";
export {
  createWebhookTemplateResolver,
  type WebhookTemplateResolver,
  WEBHOOK_EVENT_HANDLER_TEMPLATE_PATH,
  WEBHOOK_SUBMIT_ACTION_TEMPLATE_PATH,
  WEBHOOK_VALIDATION_ACTION_TEMPLATE_PATH,
  EVENT_TYPE_ITEM_ROOT,
  EVENT_TYPE_PUBLISH_ROOT,
} from "./api/templates";
export { runWebhookAuthoringGraphQL, type WebhookRequestOptions } from "./api/graphql";

// `toLogger` and `printWebhookResult` deliberately omitted — they're
// CLI presentation helpers (Logger wraps consola + log-file routing,
// `printWebhookResult` writes to stdout). SDK consumers should bring
// their own presentation; if they need the Logger they can import it
// from `@sitecoreai-labs/sitecoreai-cli/...` once a stable subpath
// exposes it (none does today, deliberately).
export {
  type WebhookTaskOptions,
  type ResolvedWebhookTenant,
  resolveWebhookTenant,
} from "./tasks/shared";
export {
  runWebhookList,
  type WebhookListOptions,
  type WebhookListResult,
  type WebhookEventCategory,
} from "./tasks/list";
export { runWebhookInspect, parseWebhookRef, type WebhookInspectOptions } from "./tasks/inspect";
export {
  runWebhookCreate,
  type WebhookCreateOptions,
  type WebhookCreateResult,
} from "./tasks/create";
export {
  runWebhookDelete,
  type WebhookDeleteOptions,
  type WebhookDeleteResult,
} from "./tasks/delete";
export {
  runWebhookEventTypes,
  type WebhookEventTypesOptions,
  type WebhookEventTypesResult,
} from "./tasks/event-types";
