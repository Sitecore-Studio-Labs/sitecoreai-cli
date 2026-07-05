import { randomUUID } from "node:crypto";
import type {
  AddItemVersionInput,
  AddItemVersionResult,
  AuthoringApiClient,
  CreateItemInput,
  CreateItemResult,
  GetItemOptions,
  ItemSelector,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
  UploadMediaInput,
  UploadMediaResult,
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
  public readonly versionAdds: AddItemVersionInput[] = [];
  /** itemId (lowercased) → language → version count. Seeded to {en:1} by createItem. */
  private readonly versionsByItem = new Map<string, Map<string, number>>();
  public throwOn?: { method: "createItem" | "updateItem"; match: string; message: string };

  /** Pre-load an item, e.g. for idempotency-on-second-push tests. */
  preload(item: MockItem): void {
    this.itemsByPath.set(lower(item.path), item);
    this.itemsById.set(lower(item.itemId), item);
    // A preloaded item exists on the tenant — like any real Sitecore item
    // it has version 1 in the default language. Tests that need a richer
    // version stack call `addItemVersion` on top.
    this.versionsByItem.set(lower(item.itemId), new Map([["en", 1]]));
  }

  peek(selector: ItemSelector): MockItem | undefined {
    if (selector.itemId) return this.itemsById.get(lower(selector.itemId));
    if (selector.path) return this.itemsByPath.get(lower(selector.path));
    return undefined;
  }

  async getItem(selector: ItemSelector, options?: GetItemOptions): Promise<RemoteItem | null> {
    const found = this.peek(selector);
    if (!found) return null;
    const lang = options?.language;
    const ver = options?.version;
    if (lang === undefined && ver === undefined) return found;
    // Filter fields to those matching (language, version). Shared fields
    // (no language, no version) always pass through — they apply to every
    // language/version. Versioned fields must match the requested
    // language; when a version is requested, the field's version must
    // match too. Mirrors the per-(language, version) read semantics of
    // the real Authoring API where the where clause scopes fields to a
    // specific version stack.
    const filtered = found.fields.filter((f) => {
      const isShared = f.language === undefined && f.version === undefined;
      if (isShared) return true;
      if (lang !== undefined && f.language !== undefined && f.language !== lang) return false;
      if (ver !== undefined && f.version !== undefined && f.version !== ver) return false;
      return true;
    });
    return { ...found, fields: filtered };
  }

  /**
   * Production behavior: one POST per ~25 paths via aliased GraphQL.
   * Mock-side: just walk the in-memory map. Caller-key contract — the
   * returned Map keys are the exact strings the caller passed in.
   */
  async getItemsByPaths(paths: readonly string[]): Promise<Map<string, RemoteItem | null>> {
    const result = new Map<string, RemoteItem | null>();
    for (const p of paths) {
      result.set(p, this.peek({ path: p }) ?? null);
    }
    return result;
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
    // Faithful to the real Authoring API: `createItem` returns DASHLESS
    // itemIds. Keeping the mock dashed hid a real bug — dashless captured
    // ids were written verbatim into multilist fields, which Sitecore
    // silently ignores (e.g. `__Masters` insert options never resolved).
    const itemId = randomUUID().replace(/-/g, "");

    const item: MockItem = {
      itemId,
      templateId: input.templateId,
      parentId: parentItem?.itemId ?? "",
      name: input.name,
      path: itemPath,
      fields: input.fields.map((f) => ({
        fieldId: f.fieldId,
        // Preserve fieldName so the planner's name-based lookup (used for
        // recipe-created fields whose IR-internal fieldId differs from
        // the tenant's server-assigned GUID) finds a match on re-push.
        ...(f.fieldName !== undefined ? { name: f.fieldName } : {}),
        value: renderRefValue(f.value),
        language: f.language,
        version: f.version,
      })),
    };
    this.itemsByPath.set(lower(itemPath), item);
    this.itemsById.set(lower(itemId), item);
    // A freshly created item has version 1 in the default language.
    this.versionsByItem.set(lower(itemId), new Map([["en", 1]]));
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
        ...(incoming.fieldName !== undefined ? { name: incoming.fieldName } : {}),
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
    this.versionsByItem.delete(lower(item.itemId));
  }

  async addItemVersion(input: AddItemVersionInput): Promise<AddItemVersionResult> {
    this.versionAdds.push(input);
    const key = lower(input.itemId);
    let byLanguage = this.versionsByItem.get(key);
    if (!byLanguage) {
      byLanguage = new Map();
      this.versionsByItem.set(key, byLanguage);
    }
    const next = (byLanguage.get(input.language) ?? 0) + 1;
    byLanguage.set(input.language, next);
    return { version: next };
  }

  async getItemVersions(selector: ItemSelector, language: string): Promise<number[]> {
    const item = this.peek(selector);
    if (!item) return [];
    const count = this.versionsByItem.get(lower(item.itemId))?.get(language) ?? 0;
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  /**
   * Tenant-level language ISO codes the mock advertises to callers of
   * `getTenantLanguages`. Defaults to `["en"]` so existing tests that
   * don't care about multi-language stay unchanged; tests exercising
   * the multi-language path mutate this directly before the snapshot
   * runs.
   */
  public tenantLanguages: string[] = ["en"];
  /**
   * Opt-in failure mode for the schema-unsupported test path. When set,
   * `getTenantLanguages` throws as if the tenant's Authoring schema
   * doesn't expose the languages query. The real client catches and
   * defaults to `["en"]` — exercise that path by flipping this flag.
   */
  public tenantLanguagesUnsupported = false;

  /**
   * Counters so tests can assert wire-call reduction without time-keeping.
   * `getItemPerLanguageBatch` and `getItemAtVersionsBatch` increment by 1
   * per batched call regardless of how many tuples were inside — that's
   * the whole point of batching.
   */
  public batchCallCounts = {
    perLanguageBatch: 0,
    atVersionsBatch: 0,
  };

  async getItemPerLanguageBatch(
    selector: ItemSelector,
    languages: readonly string[]
  ): Promise<Array<{ language: string; versions: number[]; item: RemoteItem | null }>> {
    // Mirror the real client: empty input is a no-op, no wire call.
    if (languages.length === 0) return [];
    this.batchCallCounts.perLanguageBatch += 1;
    const found = this.peek(selector);
    if (!found) return languages.map((language) => ({ language, versions: [], item: null }));
    return languages.map((language) => {
      const versionCount = this.versionsByItem.get(lower(found.itemId))?.get(language) ?? 0;
      if (versionCount === 0) return { language, versions: [], item: null };
      // Mirror the real client: return the item with fields filtered to
      // (this language, latest version) plus shared fields. The mock's
      // stored fields already carry language/version tags.
      const latest = versionCount;
      const filtered = found.fields.filter((f) => {
        const isShared = f.language === undefined && f.version === undefined;
        if (isShared) return true;
        if (f.language !== undefined && f.language !== language) return false;
        if (f.version !== undefined && f.version !== latest) return false;
        return true;
      });
      const versions = Array.from({ length: versionCount }, (_, i) => i + 1);
      return { language, versions, item: { ...found, fields: filtered } };
    });
  }

  async getItemAtVersionsBatch(
    selector: ItemSelector,
    requests: ReadonlyArray<{ language: string; version: number }>
  ): Promise<Array<RemoteItem | null>> {
    if (requests.length === 0) return [];
    this.batchCallCounts.atVersionsBatch += 1;
    const found = this.peek(selector);
    if (!found) return requests.map(() => null);
    return requests.map(({ language, version }) => {
      const versionCount = this.versionsByItem.get(lower(found.itemId))?.get(language) ?? 0;
      if (version > versionCount) return null;
      const filtered = found.fields.filter((f) => {
        const isShared = f.language === undefined && f.version === undefined;
        if (isShared) return true;
        if (f.language !== undefined && f.language !== language) return false;
        if (f.version !== undefined && f.version !== version) return false;
        return true;
      });
      return { ...found, fields: filtered };
    });
  }

  async getTenantLanguages(): Promise<string[]> {
    if (this.tenantLanguagesUnsupported) {
      throw new Error("Cannot query field 'languages' on type 'Query' (simulated).");
    }
    return [...this.tenantLanguages];
  }

  /** Inputs the executor handed to `uploadMedia` — assertable from tests. */
  public readonly mediaUploads: UploadMediaInput[] = [];

  async uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
    this.mediaUploads.push(input);
    const absolutePath = `/sitecore/media library/${input.itemPath}`;
    const itemId = randomUUID().replace(/-/g, "");
    const item: MockItem = {
      itemId,
      templateId: "f1828a2c7e5d4bbd98ca320474871548", // Unversioned/Jpeg or similar
      parentId: "",
      name: input.itemPath.split("/").pop() ?? "media",
      path: absolutePath,
      fields: input.alt
        ? [{ fieldId: "65885c44-8fcd-4a7f-94f1-ee63703fe193", name: "Alt", value: input.alt }]
        : [],
    };
    this.preload(item);
    return { itemId, itemPath: absolutePath, name: item.name };
  }
}
