import { ensureAllowWrite } from "@/policy/allow-write";
import { createScaiError } from "@/shared/errors";
import { parseWebhookRef } from "./get";
import {
  printWebhookResult,
  resolveWebhookTenant,
  toLogger,
  type WebhookTaskOptions,
} from "./shared";

export interface WebhookDeleteOptions extends WebhookTaskOptions {
  /** Item GUID or content-tree path of the webhook handler. */
  webhook: string;
  /** Per-invocation override of the env's `allowWrite` flag. */
  allowWrite?: boolean;
  /** Plan-only — no mutation. */
  whatIf?: boolean;
}

export interface WebhookDeleteResult {
  status: "deleted" | "what-if" | "not-found";
  webhook: string;
}

export const runWebhookDelete = async (
  options: WebhookDeleteOptions
): Promise<WebhookDeleteResult> => {
  const logger = toLogger(options);
  if (!options.webhook) {
    throw createScaiError("Webhook reference is required.", "INPUT_INVALID");
  }
  const selector = parseWebhookRef(options.webhook);
  const { envName, root, client } = resolveWebhookTenant(options);

  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode — no webhook will be deleted.", "yellow");
  }

  // Verify the handler exists first — issues a clean "not-found" error
  // rather than a generic deleteItem failure.
  const detail = await client.getEventHandler(selector);
  if (!detail) {
    const result: WebhookDeleteResult = { status: "not-found", webhook: options.webhook };
    printWebhookResult({
      logger,
      command: "webhook.delete",
      envName,
      result,
      humanLines: [`No webhook handler found at ${options.webhook}.`],
    });
    return result;
  }

  if (options.whatIf) {
    const result: WebhookDeleteResult = { status: "what-if", webhook: options.webhook };
    printWebhookResult({
      logger,
      command: "webhook.delete",
      envName,
      result,
      humanLines: [`Would delete ${detail.name} (${detail.itemId}) at ${detail.path}.`],
    });
    return result;
  }

  await client.deleteWebhookItem({ itemId: detail.itemId });
  const result: WebhookDeleteResult = { status: "deleted", webhook: options.webhook };
  printWebhookResult({
    logger,
    command: "webhook.delete",
    envName,
    result,
    humanLines: [`Deleted ${detail.name} (${detail.itemId}) from ${detail.path}.`],
  });
  return result;
};
