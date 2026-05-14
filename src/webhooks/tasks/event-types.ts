import type { WebhookEventTypeCategory, WebhookEventTypeSummary } from "../api";
import {
  printWebhookResult,
  resolveWebhookTenant,
  toLogger,
  type WebhookTaskOptions,
} from "./shared";

export interface WebhookEventTypesOptions extends WebhookTaskOptions {
  /** Limit results to a single catalog branch. */
  category?: WebhookEventTypeCategory;
}

export interface WebhookEventTypesResult {
  eventTypes: WebhookEventTypeSummary[];
}

/**
 * Discover which event-type strings the target tenant accepts for
 * `scai webhook create --events <name>`. The catalog lives in Sitecore
 * content under `/sitecore/system/Settings/Webhooks/Event Types/` and
 * is tenant-customizable, so we resolve it at runtime rather than
 * baking a static list into the SDK.
 *
 * Output orders `item` events first, then `publish`. Within a category
 * the order matches the Sitecore content tree's child order — operators
 * see what the CMS shows them, not an alphabetized rewrite.
 */
export const runWebhookEventTypes = async (
  options: WebhookEventTypesOptions
): Promise<WebhookEventTypesResult> => {
  const logger = toLogger(options);
  const { envName, client } = resolveWebhookTenant(options);

  const eventTypes = await client.listEventTypes(
    options.category !== undefined ? { category: options.category } : undefined
  );

  const lines =
    eventTypes.length > 0
      ? eventTypes.map((e) => `  [${e.category}] ${e.name}  (${e.itemId})`)
      : ["No webhook event types found in the tenant catalog."];

  printWebhookResult({
    logger,
    command: "webhook.event-types",
    envName,
    result: { eventTypes },
    humanLines: [`Webhook event types in '${envName}':`, ...lines],
  });

  return { eventTypes };
};
