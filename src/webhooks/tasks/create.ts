import { ensureAllowWrite } from "@/policy/allow-write";
import { createScaiError } from "@/shared/errors";
import type {
  CreateEventHandlerInput,
  CreateWorkflowActionInput,
  WebhookHandlerSummary,
  WebhookSerializationType,
} from "../api/client";
import {
  printWebhookResult,
  resolveWebhookTenant,
  toLogger,
  type WebhookTaskOptions,
} from "./shared";

/**
 * Three flavors:
 *
 *   - `item` / `publish` — create a Webhook Event Handler under
 *     `/sitecore/system/Webhooks` (or `--parent-path`). Use `--event`
 *     one or more times to pick event-type catalog entries.
 *   - `workflow` — create a Webhook Submit Action or Validation Action
 *     under a workflow state's (or command's) `Actions` folder. Use
 *     `--on-state` (or `--on-command`) to point at the parent; pick
 *     `--action submit|validation`.
 */
export interface WebhookCreateOptions extends WebhookTaskOptions {
  /** Item name for the new handler. */
  name: string;
  url: string;
  /** Discriminator. */
  event: "item" | "publish" | "workflow";
  /**
   * Event-type names (e.g. `item:saved`, `publish:end`). Required for
   * the `item` and `publish` event flavors; ignored for `workflow`.
   * Can be a comma-separated string or repeated occurrences.
   */
  events?: string[];
  /**
   * For workflow webhooks — absolute path to the workflow state or
   * command under which the action item is created (i.e.
   * `/sitecore/system/Workflows/My Workflow/Draft` or `.../Submit`).
   */
  onState?: string;
  /** For workflow webhooks — `submit` (default) or `validation`. */
  action?: "submit" | "validation";
  description?: string;
  /** Optional absolute path to an Authorization item. */
  authorization?: string;
  serializationType?: WebhookSerializationType;
  /** Override parent path for item/publish handlers. */
  parentPath?: string;
  /** Per-invocation override of the env's `allowWrite` flag. */
  allowWrite?: boolean;
  /** Plan-only — no mutation. */
  whatIf?: boolean;
  enabled?: boolean;
}

export interface WebhookCreateResult {
  status: "created" | "what-if";
  handler: WebhookHandlerSummary | null;
  plan: {
    flavor: "item" | "publish" | "workflow";
    name: string;
    url: string;
    events?: string[];
    workflowAction?: "submit" | "validation";
    parent: string;
  };
}

const isItemOrPublishFlavor = (event: WebhookCreateOptions["event"]): event is "item" | "publish" =>
  event === "item" || event === "publish";

export const runWebhookCreate = async (
  options: WebhookCreateOptions
): Promise<WebhookCreateResult> => {
  const logger = toLogger(options);
  if (!options.name) {
    throw createScaiError("--name is required.", "INPUT_INVALID");
  }
  if (!options.url) {
    throw createScaiError("--url is required.", "INPUT_INVALID");
  }

  const { envName, root, client } = resolveWebhookTenant(options);

  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode — no webhook will be created.", "yellow");
  }

  if (isItemOrPublishFlavor(options.event)) {
    if (!options.events || options.events.length === 0) {
      throw createScaiError(
        "--event item|publish requires at least one --events <name>.",
        "INPUT_INVALID",
        { hint: "Pass --events item:saved (repeat or comma-separate for multiple)." }
      );
    }
    const expectedPrefix = options.event === "item" ? "item:" : "publish:";
    for (const e of options.events) {
      if (!e.startsWith(expectedPrefix)) {
        throw createScaiError(
          `Event '${e}' is not a ${options.event}-event (must start with '${expectedPrefix}').`,
          "INPUT_INVALID"
        );
      }
    }

    const plan: WebhookCreateResult["plan"] = {
      flavor: options.event,
      name: options.name,
      url: options.url,
      events: [...options.events],
      parent: options.parentPath ?? "/sitecore/system/Webhooks",
    };

    if (options.whatIf) {
      const result: WebhookCreateResult = { status: "what-if", handler: null, plan };
      printWebhookResult({
        logger,
        command: "webhook.create",
        envName,
        result,
        humanLines: [
          `Would create '${options.name}' under ${plan.parent} for events [${plan.events!.join(", ")}].`,
        ],
      });
      return result;
    }

    const input: CreateEventHandlerInput = {
      name: options.name,
      url: options.url,
      events: options.events,
      ...(options.enabled !== undefined && { enabled: options.enabled }),
      ...(options.description !== undefined && { description: options.description }),
      ...(options.authorization !== undefined && { authorizationPath: options.authorization }),
      ...(options.serializationType !== undefined && {
        serializationType: options.serializationType,
      }),
      ...(options.parentPath !== undefined && { parentPath: options.parentPath }),
    };
    const handler = await client.createEventHandler(input);
    const result: WebhookCreateResult = { status: "created", handler, plan };
    printWebhookResult({
      logger,
      command: "webhook.create",
      envName,
      result,
      humanLines: [`Created webhook '${handler.name}' (${handler.itemId}) at ${handler.path}.`],
    });
    return result;
  }

  // workflow flavor
  if (!options.onState) {
    throw createScaiError(
      "--event workflow requires --on-state pointing at a workflow state or command path.",
      "INPUT_INVALID"
    );
  }
  const actionKind = options.action ?? "submit";
  const plan: WebhookCreateResult["plan"] = {
    flavor: "workflow",
    name: options.name,
    url: options.url,
    workflowAction: actionKind,
    parent: `${options.onState.replace(/\/$/, "")}/Actions`,
  };

  if (options.whatIf) {
    const result: WebhookCreateResult = { status: "what-if", handler: null, plan };
    printWebhookResult({
      logger,
      command: "webhook.create",
      envName,
      result,
      humanLines: [
        `Would create workflow ${actionKind}-action '${options.name}' under ${plan.parent}.`,
      ],
    });
    return result;
  }

  const input: CreateWorkflowActionInput = {
    name: options.name,
    url: options.url,
    stateOrCommandPath: options.onState,
    ...(options.enabled !== undefined && { enabled: options.enabled }),
    ...(options.description !== undefined && { description: options.description }),
    ...(options.authorization !== undefined && { authorizationPath: options.authorization }),
    ...(options.serializationType !== undefined && {
      serializationType: options.serializationType,
    }),
  };
  const handler =
    actionKind === "validation"
      ? await client.createWorkflowValidationAction(input)
      : await client.createWorkflowSubmitAction(input);
  const result: WebhookCreateResult = { status: "created", handler, plan };
  printWebhookResult({
    logger,
    command: "webhook.create",
    envName,
    result,
    humanLines: [
      `Created workflow ${actionKind}-action '${handler.name}' (${handler.itemId}) at ${handler.path}.`,
    ],
  });
  return result;
};
