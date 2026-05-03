import type { EnvironmentConfiguration } from "@/config";
import { createCliError } from "@/shared/errors";
import type { FieldValue } from "../ir/operations";
import { SITECORE_TEMPLATES } from "../ir/sitecore-templates";
import { dashifyGuid, renderRefValue } from "./ref-encoding";
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

/** Sitecore itemIds are uuids — bare or wrapped in curly braces. Anything
 *  that doesn't look like one is treated as a content-tree path. */
const GUID_PATTERN = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

const isItemId = (value: string): boolean => GUID_PATTERN.test(value.trim());

/**
 * Pick the folder template scai will auto-create missing parent path
 * segments under. Conventional SXA template per tree:
 *
 * - `/sitecore/templates/...`         → `Template Folder` (the SXA editor
 *                                        treats these as templates-tree
 *                                        organisational nodes)
 * - `/sitecore/layout/Renderings/...` → `Rendering Folder` (verified
 *                                        against live tenant — section
 *                                        folders under
 *                                        `/sitecore/layout/Renderings/Project/<site>/`
 *                                        all conform to this template,
 *                                        not generic `Folder`)
 * - everything else                   → generic `Folder`
 *
 * Picking the wrong template here doesn't break createItem itself, but
 * it can leave SXA's editor UI unable to recognise the auto-created
 * folder when walking the tree.
 */
const folderTemplateForPath = (path: string): string => {
  const normalized = path.toLowerCase();
  if (normalized.startsWith("/sitecore/templates/")) {
    return SITECORE_TEMPLATES.TEMPLATE_FOLDER;
  }
  if (normalized.startsWith("/sitecore/layout/renderings/")) {
    return SITECORE_TEMPLATES.RENDERING_FOLDER;
  }
  return SITECORE_TEMPLATES.FOLDER;
};

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
    throw createCliError("ItemSelector requires either path or itemId.", "INPUT_INVALID");
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
    throw createCliError("ItemSelector requires either path or itemId.", "INPUT_INVALID");
  };

  /**
   * Walk the content-tree path bottom-up, returning the itemId of `path`.
   * Creates any missing segments using `folderTemplateForPath`. Recursive
   * — each level either finds an existing item OR creates one and walks
   * up further. The Sitecore root (`/sitecore`) MUST already exist; any
   * path that bottoms out before reaching an existing ancestor throws.
   *
   * Used by `createItem` to satisfy Authoring GraphQL's
   * `CreateItemInput.parent: ID!` typing — callers pass paths, scai
   * resolves to itemIds (auto-provisioning the SXA-style folder chain
   * if the tenant's per-site templates/renderings/content folders
   * haven't been scaffolded yet).
   */
  const ensurePathExists = async (rawPath: string): Promise<string> => {
    const path = rawPath.replace(/\/+$/, "");
    const existing = await fetchOne({ path });
    if (existing) return existing.itemId;

    const lastSlash = path.lastIndexOf("/");
    if (lastSlash <= 0) {
      throw createCliError(
        `Cannot auto-create root path '${path}'. The Sitecore root must already exist on the tenant.`,
        "INPUT_INVALID"
      );
    }
    const parentPath = path.slice(0, lastSlash);
    const name = path.slice(lastSlash + 1);
    if (!name) {
      throw createCliError(`Path '${rawPath}' has no leaf segment to create.`, "INPUT_INVALID");
    }
    const parentItemId = await ensurePathExists(parentPath);
    const templateId = folderTemplateForPath(path);

    const data = await runAuthoringGraphQL<GraphQLCreateItemResponse>(
      environment,
      CREATE_ITEM_MUTATION,
      {
        input: {
          parent: parentItemId,
          templateId,
          name,
          database: "master",
          language: "en",
          fields: [],
        },
      },
      request
    );
    const itemId = data.createItem?.item?.itemId;
    if (!itemId) {
      throw createCliError(
        `Auto-provisioning failed: Authoring API returned no itemId after creating folder '${path}'.`,
        "UNKNOWN"
      );
    }
    return itemId;
  };

  /**
   * Resolve a `CreateItemInput.parent` value (itemId GUID OR content-tree
   * path) to a Sitecore itemId. The Authoring API's
   * `CreateItemInput.parent` is typed `ID!`, so paths must be resolved
   * before the mutation — otherwise GraphQL fails with
   * "Unable to convert type from String to Guid". Missing path segments
   * are auto-created as folders.
   */
  const resolveParentItemId = async (parent: string): Promise<string> => {
    const trimmed = parent.trim();
    if (isItemId(trimmed)) return trimmed.replace(/[{}]/g, "");
    if (trimmed.startsWith("/")) return ensurePathExists(trimmed);
    throw createCliError(
      `createItem.input.parent must be a Sitecore itemId or content-tree path; got: '${trimmed}'.`,
      "INPUT_INVALID"
    );
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
      const parentItemId = await resolveParentItemId(input.parent);
      const data = await runAuthoringGraphQL<GraphQLCreateItemResponse>(
        environment,
        CREATE_ITEM_MUTATION,
        {
          input: {
            parent: parentItemId,
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
        throw createCliError(
          "createItem returned no itemId — Authoring API response was malformed.",
          "UNKNOWN"
        );
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
      else throw createCliError("deleteItem requires either path or itemId.", "INPUT_INVALID");
      const data = await runAuthoringGraphQL<{
        deleteItem: { successful: boolean } | null;
      }>(environment, DELETE_ITEM_MUTATION, { input }, request);
      if (!data.deleteItem?.successful) {
        throw createCliError(
          `deleteItem returned successful: ${data.deleteItem?.successful} for ${
            selector.itemId ?? selector.path ?? "(no selector)"
          }`,
          "UNKNOWN"
        );
      }
    },
  };
};
