import type { WebhookHandlerSummary } from "../api";
import {
  printWebhookResult,
  resolveWebhookTenant,
  toLogger,
  type WebhookTaskOptions,
} from "./shared";

export type WebhookEventCategory = "item" | "publish" | "workflow";

export interface WebhookListOptions extends WebhookTaskOptions {
  /**
   * Override the content-tree root to scan. Defaults to
   * `/sitecore/system/Webhooks` (where item + publish event handlers
   * live). Workflow webhook actions live under workflow states and
   * require a per-state root override.
   */
  root?: string;
  /** Filter to handlers whose template name matches the category. */
  eventType?: WebhookEventCategory;
  /** Return only enabled handlers. */
  enabledOnly?: boolean;
}

export interface WebhookListResult {
  rootPath: string;
  handlers: WebhookHandlerSummary[];
}

const TEMPLATE_NAME_BY_CATEGORY: Record<WebhookEventCategory, string> = {
  item: "Webhook Event Handler",
  publish: "Webhook Event Handler",
  workflow: "Webhook Submit Action",
};

/**
 * List webhook handler items under the configured tree. Categories
 * `item` and `publish` filter the same template (the catalog
 * distinguishes them by the `Events` field, not the handler template).
 * Category `workflow` filters to Submit Actions; pair with a `--root`
 * pointing at a workflow state to find workflow webhooks attached to
 * a specific transition.
 */
export const runWebhookList = async (
  options: WebhookListOptions
): Promise<WebhookListResult> => {
  const logger = toLogger(options);
  const { envName, client } = resolveWebhookTenant(options);

  const rootPath = options.root ?? "/sitecore/system/Webhooks";
  const all = await client.listEventHandlers({
    rootPath,
    ...(options.enabledOnly !== undefined && { enabledOnly: options.enabledOnly }),
  });
  const handlers = options.eventType
    ? all.filter((h) => h.templateName === TEMPLATE_NAME_BY_CATEGORY[options.eventType!])
    : all;

  const lines =
    handlers.length > 0
      ? handlers.map((h) => `${h.name} (${h.itemId}) — ${h.path}${h.templateName ? ` [${h.templateName}]` : ""}`)
      : [`No webhook handlers found under ${rootPath}.`];

  printWebhookResult({
    logger,
    command: "webhook.list",
    envName,
    result: { rootPath, handlers },
    humanLines: lines,
  });

  return { rootPath, handlers };
};
