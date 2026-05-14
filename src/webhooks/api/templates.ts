import type { EnvironmentConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { runWebhookAuthoringGraphQL, type WebhookRequestOptions } from "./graphql";

/**
 * Runtime resolvers for Sitecore template IDs and event-type catalog
 * item IDs needed by `scai webhook create`.
 *
 * **Why runtime, not hardcoded.** XM Cloud ships these templates and
 * catalog items as part of base content, but Sitecore has never
 * published their GUIDs as a public contract — they're treated as
 * tenant-internal. They should be stable within a major version, but
 * resolving by path keeps the CLI working if a tenant has been
 * customized or if Sitecore ever renumbers them in a base-content
 * update.
 *
 * Both resolvers cache per-instance — the resolver is constructed
 * once per `WebhookApiClient` invocation, so subsequent `create` calls
 * within the same task run share the cache and pay for resolution
 * once.
 */

export const WEBHOOK_EVENT_HANDLER_TEMPLATE_PATH =
  "/sitecore/templates/System/Webhooks/Webhook Event Handler";
export const WEBHOOK_SUBMIT_ACTION_TEMPLATE_PATH =
  "/sitecore/templates/System/Workflow/Webhook Submit Action";
export const WEBHOOK_VALIDATION_ACTION_TEMPLATE_PATH =
  "/sitecore/templates/System/Workflow/Webhook Validation Action";

export const EVENT_TYPE_ITEM_ROOT = "/sitecore/system/Settings/Webhooks/Event Types/Item";
export const EVENT_TYPE_PUBLISH_ROOT = "/sitecore/system/Settings/Webhooks/Event Types/Publish";

const LOOKUP_ITEM_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    itemId
    name
    path
  }
}`;

type LookupItemByPathResponse = {
  item: { itemId: string; name: string; path: string } | null;
};

export interface WebhookTemplateResolver {
  /** Resolve the Webhook Event Handler template's item ID. */
  webhookEventHandlerTemplateId(): Promise<string>;
  /** Resolve the Webhook Submit Action (workflow) template's item ID. */
  webhookSubmitActionTemplateId(): Promise<string>;
  /** Resolve the Webhook Validation Action (workflow) template's item ID. */
  webhookValidationActionTemplateId(): Promise<string>;
  /**
   * Resolve a set of event-type names (e.g. `item:saved`, `publish:end`)
   * to their catalog item IDs. Missing events throw `INPUT_INVALID`
   * with a hint pointing at the catalog tree.
   */
  resolveEventTypeIds(eventNames: readonly string[]): Promise<string[]>;
  /** Generic path resolution. Returns null if the item doesn't exist. */
  resolveItemIdByPath(path: string): Promise<string | null>;
}

export const createWebhookTemplateResolver = (
  environment: EnvironmentConfiguration,
  request?: WebhookRequestOptions
): WebhookTemplateResolver => {
  const cache = new Map<string, string | null>();

  const resolveItemIdByPath = async (path: string): Promise<string | null> => {
    if (cache.has(path)) return cache.get(path) ?? null;
    const data = await runWebhookAuthoringGraphQL<LookupItemByPathResponse>(
      environment,
      LOOKUP_ITEM_BY_PATH,
      { path },
      request
    );
    const id = data.item?.itemId ?? null;
    cache.set(path, id);
    return id;
  };

  const resolveTemplate = async (path: string, label: string): Promise<string> => {
    const id = await resolveItemIdByPath(path);
    if (!id) {
      throw createScaiError(
        `Could not resolve the ${label} template at '${path}'.`,
        "ENV_NOT_FOUND",
        {
          hint: "Verify the path exists on the target tenant. XM Cloud ships this template in base content; if it's missing, the tenant may be on an older version or the path was customized.",
        }
      );
    }
    return id;
  };

  return {
    webhookEventHandlerTemplateId: () =>
      resolveTemplate(WEBHOOK_EVENT_HANDLER_TEMPLATE_PATH, "Webhook Event Handler"),
    webhookSubmitActionTemplateId: () =>
      resolveTemplate(WEBHOOK_SUBMIT_ACTION_TEMPLATE_PATH, "Webhook Submit Action"),
    webhookValidationActionTemplateId: () =>
      resolveTemplate(WEBHOOK_VALIDATION_ACTION_TEMPLATE_PATH, "Webhook Validation Action"),
    resolveEventTypeIds: async (eventNames: readonly string[]): Promise<string[]> => {
      const ids: string[] = [];
      for (const name of eventNames) {
        const isPublish = name.startsWith("publish:");
        const root = isPublish ? EVENT_TYPE_PUBLISH_ROOT : EVENT_TYPE_ITEM_ROOT;
        const path = `${root}/${name}`;
        const id = await resolveItemIdByPath(path);
        if (!id) {
          throw createScaiError(`Unknown webhook event type '${name}'.`, "INPUT_INVALID", {
            hint: `Expected a catalog item at '${path}'. Check '/sitecore/system/Settings/Webhooks/Event Types' on the tenant for the correct event name.`,
          });
        }
        ids.push(id);
      }
      return ids;
    },
    resolveItemIdByPath,
  };
};
