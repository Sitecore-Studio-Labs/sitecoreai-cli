import type { EnvironmentConfiguration } from "@/config";
import type { FieldValue } from "../ir/operations";
import { renderRefValue } from "./ref-encoding";
import {
  type AuthoringApiClient,
  type CreateItemInput,
  type CreateItemResult,
  type GetItemOptions,
  type ItemSelector,
  type RemoteItem,
  type UpdateItemInput,
} from "./client";
import { runAuthoringGraphQL, type AuthoringRequestOptions } from "./graphql";

/**
 * Production `AuthoringApiClient` against Sitecore Authoring GraphQL.
 *
 * Schema verified against XM Cloud Authoring API via introspection
 * (2026-04-30). Notable shape facts:
 *
 * - `Item.parent` and `Item.template` are sub-objects (not flat scalars).
 * - `CreateItemInput` does NOT accept `itemId` — Sitecore assigns IDs
 *   server-side. The `createItem` response is the source of truth.
 * - `FieldValueInput` is `{ name, value, reset? }`; per-field language /
 *   version are not supported here (set at the input level via
 *   `CreateItemInput.language`).
 */

const ITEM_FRAGMENT = `
  itemId
  name
  path
  parent {
    itemId
  }
  template {
    templateId
  }
  fields(ownFields: false) {
    nodes {
      name
      value
      templateField {
        templateFieldId
      }
    }
  }
`;

const GET_ITEM_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    ${ITEM_FRAGMENT}
  }
}`;

const GET_ITEM_BY_ID = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {
    ${ITEM_FRAGMENT}
  }
}`;

const GET_CHILDREN_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    children {
      nodes {
        ${ITEM_FRAGMENT}
      }
    }
  }
}`;

const GET_CHILDREN_BY_ID = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {
    children {
      nodes {
        ${ITEM_FRAGMENT}
      }
    }
  }
}`;

const CREATE_ITEM_MUTATION = `
mutation($input: CreateItemInput!) {
  createItem(input: $input) {
    item {
      itemId
    }
  }
}`;

const UPDATE_ITEM_MUTATION = `
mutation($input: UpdateItemInput!) {
  updateItem(input: $input) {
    item {
      itemId
    }
  }
}`;

const DELETE_ITEM_MUTATION = `
mutation($input: DeleteItemInput!) {
  deleteItem(input: $input) {
    successful
  }
}`;

type RemoteItemNode = {
  itemId: string;
  name: string;
  path: string;
  parent: { itemId: string } | null;
  template: { templateId: string } | null;
  fields: {
    nodes: Array<{
      name: string;
      value: string;
      templateField: { templateFieldId: string } | null;
    }>;
  };
};

type GraphQLItemResponse = { item: RemoteItemNode | null };
type GraphQLChildrenResponse = {
  item: { children: { nodes: RemoteItemNode[] } } | null;
};
type GraphQLCreateItemResponse = {
  createItem: { item: { itemId: string } | null } | null;
};

const toRemoteItem = (node: RemoteItemNode): RemoteItem => ({
  itemId: node.itemId,
  name: node.name,
  path: node.path,
  parentId: node.parent?.itemId ?? "",
  templateId: node.template?.templateId ?? "",
  // The Authoring API returns `field.name` as the field's display name
  // (e.g. "__Icon", "componentName"). Drift detection prefers the recipe
  // op's `fieldName` when present (recipe-created fields whose GUIDs the
  // tenant doesn't recognize); else falls back to the field's GUID at
  // `field.templateField.templateFieldId`. Sitecore normalizes those GUIDs
  // without dashes, so re-format to canonical 8-4-4-4-12.
  fields: node.fields.nodes
    .filter((field) => field.templateField?.templateFieldId)
    .map((field) => ({
      fieldId: dashifyGuid(field.templateField!.templateFieldId),
      name: field.name,
      value: field.value,
    })),
});

const dashifyGuid = (guid: string): string => {
  const compact = guid.replace(/[{}-]/g, "").toLowerCase();
  if (compact.length !== 32) return guid.toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
};

const toAuthoringFieldsInput = (fields: FieldValue[]): Array<{ name: string; value: string }> =>
  fields.map((field) => ({
    // Sitecore's `FieldValueInput.name` accepts a field name OR id. For
    // recipe-created fields, the IR's `fieldId` is only a uuidv5 refKey
    // (the tenant's server-assigned GUID is different) — fall through to
    // `fieldName`, which Sitecore resolves against the item's template.
    // For system fields without a `fieldName`, the literal GUID works.
    name: field.fieldName ?? field.fieldId,
    value: renderRefValue(field.value),
  }));

export interface AuthoringClientOptions {
  environment: EnvironmentConfiguration;
  request?: AuthoringRequestOptions;
}

export const createAuthoringClient = (options: AuthoringClientOptions): AuthoringApiClient => {
  const { environment, request } = options;

  const fetchOne = async (selector: ItemSelector): Promise<RemoteItemNode | null> => {
    if (selector.itemId) {
      const data = await runAuthoringGraphQL<GraphQLItemResponse>(
        environment,
        GET_ITEM_BY_ID,
        { itemId: selector.itemId },
        request
      );
      return data.item;
    }
    if (selector.path) {
      const data = await runAuthoringGraphQL<GraphQLItemResponse>(
        environment,
        GET_ITEM_BY_PATH,
        { path: selector.path },
        request
      );
      return data.item;
    }
    throw new Error("ItemSelector requires either path or itemId.");
  };

  const fetchChildren = async (selector: ItemSelector): Promise<RemoteItemNode[]> => {
    if (selector.itemId) {
      const data = await runAuthoringGraphQL<GraphQLChildrenResponse>(
        environment,
        GET_CHILDREN_BY_ID,
        { itemId: selector.itemId },
        request
      );
      return data.item?.children.nodes ?? [];
    }
    if (selector.path) {
      const data = await runAuthoringGraphQL<GraphQLChildrenResponse>(
        environment,
        GET_CHILDREN_BY_PATH,
        { path: selector.path },
        request
      );
      return data.item?.children.nodes ?? [];
    }
    throw new Error("ItemSelector requires either path or itemId.");
  };

  return {
    async getItem(selector, _options?: GetItemOptions): Promise<RemoteItem | null> {
      const node = await fetchOne(selector);
      return node ? toRemoteItem(node) : null;
    },

    async getChildren(parent, _options?: GetItemOptions): Promise<RemoteItem[]> {
      const nodes = await fetchChildren(parent);
      return nodes.map(toRemoteItem);
    },

    async createItem(input: CreateItemInput): Promise<CreateItemResult> {
      const data = await runAuthoringGraphQL<GraphQLCreateItemResponse>(
        environment,
        CREATE_ITEM_MUTATION,
        {
          input: {
            parent: input.parent,
            templateId: input.templateId,
            name: input.name,
            database: input.database ?? "master",
            language: input.language ?? "en",
            fields: toAuthoringFieldsInput(input.fields),
          },
        },
        request
      );
      const itemId = data.createItem?.item?.itemId;
      if (!itemId) {
        throw new Error("createItem returned no itemId — Authoring API response was malformed.");
      }
      return { itemId };
    },

    async updateItem(input: UpdateItemInput): Promise<void> {
      await runAuthoringGraphQL(
        environment,
        UPDATE_ITEM_MUTATION,
        {
          input: {
            itemId: input.itemId,
            fields: toAuthoringFieldsInput(input.fields),
          },
        },
        request
      );
    },

    async deleteItem(selector: ItemSelector): Promise<void> {
      // `permanently: true` skips the recycle bin — rollback and integration
      // cleanup both want full removal. Default-false would leave items
      // discoverable by path under /sitecore/content/Recycle Bin.
      const input: {
        itemId?: string;
        path?: string;
        permanently: boolean;
      } = { permanently: true };
      if (selector.itemId) input.itemId = selector.itemId;
      else if (selector.path) input.path = selector.path;
      else throw new Error("deleteItem requires either path or itemId.");
      const data = await runAuthoringGraphQL<{
        deleteItem: { successful: boolean } | null;
      }>(environment, DELETE_ITEM_MUTATION, { input }, request);
      if (!data.deleteItem?.successful) {
        throw new Error(
          `deleteItem returned successful: ${data.deleteItem?.successful} for ${
            selector.itemId ?? selector.path ?? "(no selector)"
          }`
        );
      }
    },
  };
};
