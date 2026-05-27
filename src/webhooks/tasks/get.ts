import { createScaiError } from "@/shared/errors";
import type { WebhookHandlerDetail } from "../api/client";
import {
  printWebhookResult,
  resolveWebhookTenant,
  toLogger,
  type WebhookTaskOptions,
} from "./shared";

export interface WebhookInspectOptions extends WebhookTaskOptions {
  /** Item GUID or content-tree path of the webhook handler. */
  webhook: string;
}

const ITEM_ID_PATTERN = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

const parseWebhookRef = (value: string): { itemId?: string; path?: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw createScaiError("Webhook reference is empty.", "INPUT_INVALID");
  }
  if (trimmed.startsWith("/sitecore/") || trimmed.startsWith("/Sitecore/")) {
    return { path: trimmed };
  }
  if (ITEM_ID_PATTERN.test(trimmed)) {
    return { itemId: trimmed };
  }
  throw createScaiError(
    `'${value}' is not a valid webhook reference. Expected a Sitecore GUID or a content-tree path.`,
    "INPUT_INVALID"
  );
};

export const runWebhookGet = async (
  options: WebhookInspectOptions
): Promise<WebhookHandlerDetail | null> => {
  const logger = toLogger(options);
  const selector = parseWebhookRef(options.webhook);
  const { envName, client } = resolveWebhookTenant(options);

  const detail = await client.getEventHandler(selector);
  if (!detail) {
    if (logger.isJson()) {
      logger.json({
        command: "webhook.inspect",
        environment: envName,
        result: null,
        reason: "not-found",
      });
    } else {
      logger.info(`No webhook handler found at ${selector.path ?? selector.itemId}.`);
    }
    return null;
  }

  const f = detail.fields;
  const humanLines = [
    `Item:           ${detail.path}`,
    `Template:       ${detail.templateName ?? "?"}`,
    `URL:            ${f.url ?? "(unset)"}`,
    `Enabled:        ${f.enabled ? "yes" : "no"}`,
    `Serialization:  ${f.serializationType ?? "JSON"}`,
    `Authorization:  ${f.authorizationItemId ? f.authorizationItemId : "(none)"}`,
    `Description:    ${f.description ?? "(none)"}`,
    `Event count:    ${f.events.length}`,
  ];
  if (f.events.length > 0) {
    humanLines.push("Event-type GUIDs:");
    for (const e of f.events) humanLines.push(`  - ${e}`);
  }

  printWebhookResult({
    logger,
    command: "webhook.inspect",
    envName,
    result: detail,
    humanLines,
  });

  return detail;
};

export { parseWebhookRef };
