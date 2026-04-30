/**
 * Authoring API client surface for recipe execution.
 *
 * The Sitecore Authoring API server-assigns itemIds on `createItem` —
 * we cannot specify them. The recipe push therefore uses **paths** as
 * the identity hook: each CreateItem op carries a deterministic path
 * (`<templatesRoot>/<recipe.name>/...`) that the planner uses for
 * lookup, and the `createItem` mutation returns the assigned itemId,
 * which the executor caches in a per-run map keyed by recipe-internal
 * uuidv5 refKey for cross-reference resolution.
 *
 * The IR planner and executor depend only on this interface. Production
 * runs use `createAuthoringClient` from `./authoring-client`; tests
 * inject a mock — same seam either way.
 */

import type { FieldValue } from "../ir/operations";

export interface RemoteFieldValue {
  fieldId: string;
  /** Sitecore returns the raw stored value (string), regardless of field type. */
  value: string;
  /** Versioned fields carry these; shared fields do not. */
  language?: string;
  version?: number;
}

export interface RemoteItem {
  itemId: string;
  templateId: string;
  parentId: string;
  name: string;
  /** Sitecore content-tree path of the item, e.g. `/sitecore/templates/...`. */
  path: string;
  fields: RemoteFieldValue[];
}

/** Item lookup selector — Sitecore accepts either a path or a GUID id. */
export interface ItemSelector {
  path?: string;
  itemId?: string;
}

export interface CreateItemInput {
  /** Parent path (e.g. `/sitecore/templates/Project`) or parent item GUID. */
  parent: string;
  templateId: string;
  name: string;
  /** Defaults to "master" if unset. */
  database?: string;
  /** Default language for versioned fields; defaults to "en". */
  language?: string;
  fields: FieldValue[];
}

export interface CreateItemResult {
  /** Sitecore-assigned itemId (UUID without curly braces). */
  itemId: string;
}

export interface UpdateItemInput {
  itemId: string;
  fields: FieldValue[];
}

export interface GetItemOptions {
  /** Languages to fetch versioned fields for. Default: `["en"]`. */
  languages?: string[];
}

export interface AuthoringApiClient {
  /**
   * Resolve an item by path or by Sitecore-assigned itemId. Returns
   * `null` when the item does not exist.
   */
  getItem(selector: ItemSelector, options?: GetItemOptions): Promise<RemoteItem | null>;
  /** List immediate children of `parent` (selectable by path or itemId). */
  getChildren(parent: ItemSelector, options?: GetItemOptions): Promise<RemoteItem[]>;
  /**
   * Create the item at `input.parent` / `input.name`. The Authoring API
   * assigns the itemId server-side and returns it.
   */
  createItem(input: CreateItemInput): Promise<CreateItemResult>;
  updateItem(input: UpdateItemInput): Promise<void>;
  /** Phase 4 policy `CreateUpdateAndDelete` will use this. */
  deleteItem(selector: ItemSelector): Promise<void>;
}
