import type { EnvironmentConfiguration } from "@/config";
import { createScaiError } from "@/shared/errors";
import { READ_RETRYABLE_STATUSES } from "@/shared/graphql";
import { runWebhookAuthoringGraphQL, type WebhookRequestOptions } from "./graphql";
import {
  createWebhookTemplateResolver,
  EVENT_TYPE_ITEM_ROOT,
  EVENT_TYPE_PUBLISH_ROOT,
  type WebhookTemplateResolver,
} from "./templates";

/**
 * Authoring GraphQL operations for the Sitecore webhook content tree.
 *
 * Webhooks in XM Cloud are content items, not a dedicated API surface.
 * This client wraps `createItem` / `updateItem` / `deleteItem` against
 * `/sitecore/system/Webhooks` (event handlers) and the workflow
 * `Actions` subtree (submit/validation actions). See
 * `templates.ts` for the runtime template ID + event-type catalog
 * resolution.
 */

export const DEFAULT_WEBHOOK_HANDLERS_ROOT = "/sitecore/system/Webhooks";

export const WEBHOOK_FIELD_DESCRIPTION = "Description";
export const WEBHOOK_FIELD_URL = "Url";
export const WEBHOOK_FIELD_EVENTS = "Events";
export const WEBHOOK_FIELD_ENABLED = "Enabled";
export const WEBHOOK_FIELD_AUTHORIZATION = "Authorization";
export const WEBHOOK_FIELD_SERIALIZATION_TYPE = "Serialization Type";

export type WebhookSerializationType = "JSON" | "XML";

export interface WebhookHandlerSummary {
  itemId: string;
  name: string;
  path: string;
  templateName: string | null;
}

export interface WebhookHandlerFieldsMap {
  description: string | null;
  url: string | null;
  /** Raw multilist field — pipe-delimited list of event-type item IDs. */
  eventsRaw: string | null;
  /** Resolved event-type display names (e.g. `item:saved`), best-effort. */
  events: string[];
  enabled: boolean;
  authorizationItemId: string | null;
  serializationType: string | null;
}

export interface WebhookHandlerDetail extends WebhookHandlerSummary {
  fields: WebhookHandlerFieldsMap;
}

export interface CreateEventHandlerInput {
  /** Sitecore item name for the new handler. */
  name: string;
  url: string;
  /** Event-type display names (`item:saved`, `publish:end`, …). Resolved to catalog GUIDs at create time. */
  events: readonly string[];
  enabled?: boolean;
  description?: string;
  /** Absolute path to an existing Authorization item, e.g. `/sitecore/system/Settings/Webhooks/Authorizations/CI Bearer`. */
  authorizationPath?: string;
  serializationType?: WebhookSerializationType;
  /** Override the default `/sitecore/system/Webhooks` parent. */
  parentPath?: string;
}

export interface CreateWorkflowActionInput {
  /** Sitecore item name for the new action item (e.g. `Notify Reviewer`). */
  name: string;
  url: string;
  /**
   * Absolute path to the workflow state OR command under which the
   * action's `Actions` subfolder lives. The action item itself is
   * created at `<stateOrCommandPath>/Actions/<name>`; the `Actions`
   * folder is expected to exist already (created automatically by
   * Sitecore when the state/command is added).
   */
  stateOrCommandPath: string;
  description?: string;
  enabled?: boolean;
  authorizationPath?: string;
  serializationType?: WebhookSerializationType;
}

export type WebhookEventTypeCategory = "item" | "publish";

export interface WebhookEventTypeSummary {
  /** Event-type display name (e.g. `item:saved`, `publish:end`). */
  name: string;
  /** Catalog item GUID. Stable per tenant; not a Sitecore-published contract. */
  itemId: string;
  /** Catalog branch the item lives under. */
  category: WebhookEventTypeCategory;
  /** Full content-tree path of the catalog item. */
  path: string;
}

export interface WebhookApiClient {
  /**
   * List webhook event handler items under the given root (default
   * `/sitecore/system/Webhooks`). Walks direct children. Items whose
   * template is `Webhook Event Handler` are returned; folder items are
   * walked one level deeper.
   */
  listEventHandlers(options?: {
    rootPath?: string;
    enabledOnly?: boolean;
  }): Promise<WebhookHandlerSummary[]>;
  /** Fetch a single handler item with all configuration fields. */
  getEventHandler(input: { itemId?: string; path?: string }): Promise<WebhookHandlerDetail | null>;
  /**
   * Create a Webhook Event Handler item (for item/publish events).
   * Resolves event-name strings to catalog GUIDs and the template ID
   * via runtime lookups (cached per client instance).
   */
  createEventHandler(input: CreateEventHandlerInput): Promise<WebhookHandlerSummary>;
  /** Create a Webhook Submit Action under a workflow state's `Actions` folder. */
  createWorkflowSubmitAction(input: CreateWorkflowActionInput): Promise<WebhookHandlerSummary>;
  /** Create a Webhook Validation Action under a workflow command's `Actions` folder. */
  createWorkflowValidationAction(input: CreateWorkflowActionInput): Promise<WebhookHandlerSummary>;
  /** Delete any webhook item by ID or path. */
  deleteWebhookItem(input: { itemId?: string; path?: string }): Promise<void>;
  /**
   * List event-type catalog items the tenant exposes — the strings
   * callers pass to `createEventHandler({ events: [...] })`. Walks
   * `/sitecore/system/Settings/Webhooks/Event Types/{Item,Publish}` and
   * returns each catalog item's display name + GUID + category. The
   * catalog is per-tenant (Sitecore base content seeds it, customers
   * can extend it); resolve at runtime rather than baking a static
   * union into the SDK.
   */
  listEventTypes(options?: {
    category?: WebhookEventTypeCategory;
  }): Promise<WebhookEventTypeSummary[]>;
  /** Underlying template resolver, exposed for testing and cross-task use. */
  readonly templates: WebhookTemplateResolver;
}

export interface WebhookClientOptions {
  environment: EnvironmentConfiguration;
  request?: WebhookRequestOptions;
}

const ITEM_FIELDS_FRAGMENT = `
  itemId
  name
  path
  template { templateId name }
  fields(ownFields: false) {
    nodes { name value }
  }`;

const GET_ITEM_BY_ID = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {${ITEM_FIELDS_FRAGMENT}
  }
}`;

const GET_ITEM_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {${ITEM_FIELDS_FRAGMENT}
  }
}`;

const GET_CHILDREN_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    children {
      nodes {
        itemId
        name
        path
        template { templateId name }
        fields(ownFields: false) { nodes { name value } }
      }
    }
  }
}`;

const CREATE_ITEM_MUTATION = `
mutation($input: CreateItemInput!) {
  createItem(input: $input) {
    item { itemId name path }
  }
}`;

const DELETE_ITEM_MUTATION = `
mutation($input: DeleteItemInput!) {
  deleteItem(input: $input) { successful }
}`;

type FieldNode = { name: string; value: string };

type RawItemNode = {
  itemId: string;
  name: string;
  path: string;
  template: { templateId: string; name: string } | null;
  fields: { nodes: FieldNode[] };
};

type GetItemResponse = { item: RawItemNode | null };
type GetChildrenResponse = { item: { children: { nodes: RawItemNode[] } } | null };
type CreateItemResponse = {
  createItem: { item: { itemId: string; name: string; path: string } | null } | null;
};
type DeleteItemResponse = { deleteItem: { successful: boolean } | null };

const WEBHOOK_EVENT_HANDLER_TEMPLATE_NAME = "Webhook Event Handler";
const WEBHOOK_SUBMIT_ACTION_TEMPLATE_NAME = "Webhook Submit Action";
const WEBHOOK_VALIDATION_ACTION_TEMPLATE_NAME = "Webhook Validation Action";

const isWebhookFolder = (templateName: string | null): boolean =>
  templateName === "Folder" || templateName === "Webhook Folder";

const isWebhookHandlerTemplate = (templateName: string | null): boolean =>
  templateName === WEBHOOK_EVENT_HANDLER_TEMPLATE_NAME ||
  templateName === WEBHOOK_SUBMIT_ACTION_TEMPLATE_NAME ||
  templateName === WEBHOOK_VALIDATION_ACTION_TEMPLATE_NAME;

const fieldsToMap = (nodes: readonly FieldNode[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const f of nodes) map.set(f.name, f.value);
  return map;
};

const parseEventsRaw = (raw: string | null): string[] => {
  if (!raw) return [];
  return raw
    .split("|")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
};

const flattenFields = (raw: RawItemNode): WebhookHandlerFieldsMap => {
  const map = fieldsToMap(raw.fields.nodes);
  const eventsRaw = map.get(WEBHOOK_FIELD_EVENTS) ?? null;
  return {
    description: map.get(WEBHOOK_FIELD_DESCRIPTION) ?? null,
    url: map.get(WEBHOOK_FIELD_URL) ?? null,
    eventsRaw,
    // Resolving event GUIDs back to display names would require an
    // extra batch query per inspect call. Surface the raw GUID list for
    // now; callers that need display names can join with the event-type
    // catalog separately.
    events: parseEventsRaw(eventsRaw),
    enabled: (map.get(WEBHOOK_FIELD_ENABLED) ?? "").trim() === "1",
    authorizationItemId: map.get(WEBHOOK_FIELD_AUTHORIZATION) ?? null,
    serializationType: map.get(WEBHOOK_FIELD_SERIALIZATION_TYPE) ?? null,
  };
};

const toSummary = (raw: RawItemNode): WebhookHandlerSummary => ({
  itemId: raw.itemId,
  name: raw.name,
  path: raw.path,
  templateName: raw.template?.name ?? null,
});

const toDetail = (raw: RawItemNode): WebhookHandlerDetail => ({
  ...toSummary(raw),
  fields: flattenFields(raw),
});

export const createWebhookApiClient = (options: WebhookClientOptions): WebhookApiClient => {
  const { environment, request } = options;

  const readRequest: WebhookRequestOptions = {
    ...request,
    retry: { ...request?.retry, retryableStatuses: READ_RETRYABLE_STATUSES },
  };

  // Writes are not retried — the Authoring API has no idempotency-key
  // mechanism, and retrying createItem after a 503 risks producing
  // duplicate items.
  const writeRequest: WebhookRequestOptions = {
    ...(request ?? {}),
    retry: { maxAttempts: 1 },
  };

  const templates = createWebhookTemplateResolver(environment, readRequest);

  const fetchByPath = async (path: string): Promise<RawItemNode | null> => {
    const data = await runWebhookAuthoringGraphQL<GetItemResponse>(
      environment,
      GET_ITEM_BY_PATH,
      { path },
      readRequest
    );
    return data.item;
  };

  const fetchById = async (itemId: string): Promise<RawItemNode | null> => {
    const data = await runWebhookAuthoringGraphQL<GetItemResponse>(
      environment,
      GET_ITEM_BY_ID,
      { itemId },
      readRequest
    );
    return data.item;
  };

  const listChildrenRaw = async (path: string): Promise<RawItemNode[]> => {
    const data = await runWebhookAuthoringGraphQL<GetChildrenResponse>(
      environment,
      GET_CHILDREN_BY_PATH,
      { path },
      readRequest
    );
    return data.item?.children.nodes ?? [];
  };

  const listEventHandlers = async (opts?: {
    rootPath?: string;
    enabledOnly?: boolean;
  }): Promise<WebhookHandlerSummary[]> => {
    const rootPath = opts?.rootPath ?? DEFAULT_WEBHOOK_HANDLERS_ROOT;
    const results: WebhookHandlerSummary[] = [];

    const visit = async (path: string, depth: number): Promise<void> => {
      const children = await listChildrenRaw(path);
      for (const c of children) {
        const tname = c.template?.name ?? null;
        if (isWebhookHandlerTemplate(tname)) {
          if (opts?.enabledOnly) {
            const enabled =
              (fieldsToMap(c.fields.nodes).get(WEBHOOK_FIELD_ENABLED) ?? "").trim() === "1";
            if (!enabled) continue;
          }
          results.push(toSummary(c));
        } else if (isWebhookFolder(tname) && depth < 1) {
          await visit(c.path, depth + 1);
        }
      }
    };

    await visit(rootPath, 0);
    return results;
  };

  const listEventTypes = async (opts?: {
    category?: WebhookEventTypeCategory;
  }): Promise<WebhookEventTypeSummary[]> => {
    // Roots: Item/, Publish/. Walk one level — each child IS the
    // catalog item (no nested folders in base content). If a tenant
    // organizes the catalog into folders later, the surfaced names
    // skip them — operators authoring webhooks reference catalog
    // strings by their leaf name, not their tree path, so flattening
    // is the right behavior here.
    const roots: Array<[WebhookEventTypeCategory, string]> = [];
    if (opts?.category === undefined || opts.category === "item") {
      roots.push(["item", EVENT_TYPE_ITEM_ROOT]);
    }
    if (opts?.category === undefined || opts.category === "publish") {
      roots.push(["publish", EVENT_TYPE_PUBLISH_ROOT]);
    }

    const results: WebhookEventTypeSummary[] = [];
    for (const [category, root] of roots) {
      const children = await listChildrenRaw(root);
      for (const c of children) {
        results.push({
          name: c.name,
          itemId: c.itemId,
          category,
          path: c.path,
        });
      }
    }
    return results;
  };

  const getEventHandler = async (input: {
    itemId?: string;
    path?: string;
  }): Promise<WebhookHandlerDetail | null> => {
    if (!input.itemId && !input.path) {
      throw createScaiError("getEventHandler requires either itemId or path.", "INPUT_INVALID");
    }
    const raw = input.itemId ? await fetchById(input.itemId) : await fetchByPath(input.path!);
    return raw ? toDetail(raw) : null;
  };

  /**
   * Common create path — assembles `CreateItemInput`, dispatches the
   * mutation, returns a summary. `templateId`, `parent`, `name`, and
   * the field map are caller-prepared so flavor-specific helpers can
   * vary their template + parent + field set without duplicating the
   * dispatch.
   */
  const dispatchCreate = async (input: {
    templateId: string;
    parent: string;
    name: string;
    fields: Array<{ name: string; value: string }>;
  }): Promise<WebhookHandlerSummary> => {
    const payload = {
      input: {
        templateId: input.templateId,
        parent: input.parent,
        name: input.name,
        language: "en",
        database: "master",
        fields: input.fields,
      },
    };
    const data = await runWebhookAuthoringGraphQL<CreateItemResponse>(
      environment,
      CREATE_ITEM_MUTATION,
      payload,
      writeRequest
    );
    const created = data.createItem?.item;
    if (!created) {
      throw createScaiError(
        `Webhook createItem returned no item for '${input.name}' under '${input.parent}'.`,
        "UNKNOWN"
      );
    }
    return {
      itemId: created.itemId,
      name: created.name,
      path: created.path,
      templateName: null,
    };
  };

  const resolveAuthorizationItemId = async (
    authorizationPath: string | undefined
  ): Promise<string | null> => {
    if (!authorizationPath) return null;
    const id = await templates.resolveItemIdByPath(authorizationPath);
    if (!id) {
      throw createScaiError(
        `Webhook Authorization item not found at '${authorizationPath}'.`,
        "INPUT_INVALID",
        {
          hint: "Authorization items live under '/sitecore/system/Settings/Webhooks/Authorizations'. Create one in Sitecore or omit --authorization to leave the handler unauthorized.",
        }
      );
    }
    return id;
  };

  const buildSharedFields = async (
    input:
      | Pick<
          CreateEventHandlerInput,
          "url" | "enabled" | "description" | "authorizationPath" | "serializationType"
        >
      | Pick<
          CreateWorkflowActionInput,
          "url" | "enabled" | "description" | "authorizationPath" | "serializationType"
        >
  ): Promise<Array<{ name: string; value: string }>> => {
    const fields: Array<{ name: string; value: string }> = [
      { name: WEBHOOK_FIELD_URL, value: input.url },
      { name: WEBHOOK_FIELD_ENABLED, value: input.enabled === false ? "" : "1" },
      {
        name: WEBHOOK_FIELD_SERIALIZATION_TYPE,
        value: input.serializationType ?? "JSON",
      },
    ];
    if (input.description !== undefined) {
      fields.push({ name: WEBHOOK_FIELD_DESCRIPTION, value: input.description });
    }
    const authId = await resolveAuthorizationItemId(input.authorizationPath);
    if (authId) {
      fields.push({ name: WEBHOOK_FIELD_AUTHORIZATION, value: authId });
    }
    return fields;
  };

  const createEventHandler = async (
    input: CreateEventHandlerInput
  ): Promise<WebhookHandlerSummary> => {
    if (input.events.length === 0) {
      throw createScaiError(
        "createEventHandler requires at least one event type.",
        "INPUT_INVALID",
        { hint: "Pass --event <name> (e.g. 'item:saved', 'publish:end')." }
      );
    }
    const [templateId, eventGuids] = await Promise.all([
      templates.webhookEventHandlerTemplateId(),
      templates.resolveEventTypeIds(input.events),
    ]);
    const fields = await buildSharedFields(input);
    // Events is a multilist field: pipe-delimited list of catalog item IDs.
    fields.push({ name: WEBHOOK_FIELD_EVENTS, value: eventGuids.join("|") });

    return dispatchCreate({
      templateId,
      parent: input.parentPath ?? DEFAULT_WEBHOOK_HANDLERS_ROOT,
      name: input.name,
      fields,
    });
  };

  const createWorkflowActionImpl = async (
    input: CreateWorkflowActionInput,
    templateId: string
  ): Promise<WebhookHandlerSummary> => {
    const fields = await buildSharedFields(input);
    // Actions are created under <state-or-command>/Actions. The Actions
    // folder is auto-created by Sitecore with the state/command; if it
    // is missing the create call fails with a clear "parent not found"
    // upstream error, which is the right signal to surface.
    const parent = `${input.stateOrCommandPath.replace(/\/$/, "")}/Actions`;
    return dispatchCreate({
      templateId,
      parent,
      name: input.name,
      fields,
    });
  };

  const createWorkflowSubmitAction = async (
    input: CreateWorkflowActionInput
  ): Promise<WebhookHandlerSummary> => {
    const templateId = await templates.webhookSubmitActionTemplateId();
    return createWorkflowActionImpl(input, templateId);
  };

  const createWorkflowValidationAction = async (
    input: CreateWorkflowActionInput
  ): Promise<WebhookHandlerSummary> => {
    const templateId = await templates.webhookValidationActionTemplateId();
    return createWorkflowActionImpl(input, templateId);
  };

  const deleteWebhookItem = async (input: { itemId?: string; path?: string }): Promise<void> => {
    if (!input.itemId && !input.path) {
      throw createScaiError("deleteWebhookItem requires either itemId or path.", "INPUT_INVALID");
    }
    const payload: Record<string, unknown> = {
      database: "master",
      permanently: true,
    };
    if (input.itemId) payload.itemId = input.itemId;
    else if (input.path) payload.path = input.path;
    const data = await runWebhookAuthoringGraphQL<DeleteItemResponse>(
      environment,
      DELETE_ITEM_MUTATION,
      { input: payload },
      writeRequest
    );
    if (!data.deleteItem?.successful) {
      throw createScaiError(
        `Webhook deleteItem returned successful=${data.deleteItem?.successful} for ${
          input.itemId ?? input.path
        }`,
        "UNKNOWN"
      );
    }
  };

  return {
    listEventHandlers,
    getEventHandler,
    createEventHandler,
    createWorkflowSubmitAction,
    createWorkflowValidationAction,
    deleteWebhookItem,
    listEventTypes,
    templates,
  };
};
