import { randomUUID } from "node:crypto";
import type {
  AuthoringApiClient,
  CreateItemInput,
  CreateItemResult,
  ItemSelector,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "../../../../src/recipe/api/client";
import { renderRefValue } from "../../../../src/recipe/api/ref-encoding";

/**
 * In-memory `AuthoringApiClient` for unit tests.
 *
 * Mirrors the real Authoring API's path-based identity model: items are
 * keyed by their Sitecore content-tree path. `createItem` mints a fresh
 * Sitecore-style itemId and returns it; subsequent `getItem` lookups by
 * either path or itemId find the same record.
 */

type MockItem = RemoteItem;

const lower = (s: string) => s.toLowerCase();

export class MockAuthoringClient implements AuthoringApiClient {
  public readonly itemsByPath = new Map<string, MockItem>();
  public readonly itemsById = new Map<string, MockItem>();
  public readonly creates: CreateItemInput[] = [];
  public readonly updates: UpdateItemInput[] = [];
  public throwOn?: { method: "createItem" | "updateItem"; match: string; message: string };

  /** Pre-load an item, e.g. for idempotency-on-second-push tests. */
  preload(item: MockItem): void {
    this.itemsByPath.set(lower(item.path), item);
    this.itemsById.set(lower(item.itemId), item);
  }

  peek(selector: ItemSelector): MockItem | undefined {
    if (selector.itemId) return this.itemsById.get(lower(selector.itemId));
    if (selector.path) return this.itemsByPath.get(lower(selector.path));
    return undefined;
  }

  async getItem(selector: ItemSelector): Promise<RemoteItem | null> {
    return this.peek(selector) ?? null;
  }

  async getChildren(parent: ItemSelector): Promise<RemoteItem[]> {
    const target = this.peek(parent);
    if (!target) return [];
    return Array.from(this.itemsByPath.values()).filter(
      (item) => item.parentId.toLowerCase() === target.itemId.toLowerCase()
    );
  }

  async createItem(input: CreateItemInput): Promise<CreateItemResult> {
    if (this.throwOn?.method === "createItem" && input.name === this.throwOn.match) {
      throw new Error(this.throwOn.message);
    }
    this.creates.push(input);

    // Resolve the parent: `input.parent` is either a path or an itemId.
    const parentItem = this.peek({ path: input.parent }) ?? this.peek({ itemId: input.parent });
    const parentPath = parentItem?.path ?? input.parent;
    const itemPath = `${parentPath.replace(/\/$/, "")}/${input.name}`;
    const itemId = randomUUID();

    const item: MockItem = {
      itemId,
      templateId: input.templateId,
      parentId: parentItem?.itemId ?? "",
      name: input.name,
      path: itemPath,
      fields: input.fields.map((f) => ({
        fieldId: f.fieldId,
        value: renderRefValue(f.value),
        language: f.language,
        version: f.version,
      })),
    };
    this.itemsByPath.set(lower(itemPath), item);
    this.itemsById.set(lower(itemId), item);
    return { itemId };
  }

  async updateItem(input: UpdateItemInput): Promise<void> {
    if (this.throwOn?.method === "updateItem" && input.itemId === this.throwOn.match) {
      throw new Error(this.throwOn.message);
    }
    this.updates.push(input);
    const existing = this.itemsById.get(lower(input.itemId));
    if (!existing) {
      return;
    }
    const next: RemoteFieldValue[] = [...existing.fields];
    for (const incoming of input.fields) {
      const idx = next.findIndex(
        (f) =>
          f.fieldId.toLowerCase() === incoming.fieldId.toLowerCase() &&
          f.language === incoming.language &&
          f.version === incoming.version
      );
      const rendered: RemoteFieldValue = {
        fieldId: incoming.fieldId,
        value: renderRefValue(incoming.value),
        language: incoming.language,
        version: incoming.version,
      };
      if (idx >= 0) {
        next[idx] = rendered;
      } else {
        next.push(rendered);
      }
    }
    const updated = { ...existing, fields: next };
    this.itemsByPath.set(lower(existing.path), updated);
    this.itemsById.set(lower(existing.itemId), updated);
  }

  async deleteItem(selector: ItemSelector): Promise<void> {
    const item = this.peek(selector);
    if (!item) return;
    this.itemsByPath.delete(lower(item.path));
    this.itemsById.delete(lower(item.itemId));
  }
}
