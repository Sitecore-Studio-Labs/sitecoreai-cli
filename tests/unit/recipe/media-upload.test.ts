/**
 * Unit tests for the `MediaUpload` op's planner + executor.
 *
 * The op materialises a media-library item from either a remote URL or
 * a local asset path, and stamps the server-assigned item GUID into
 * `capturedItemIds` so a sibling `SetField` op with a `media-xml-ref`
 * value can resolve. Idempotency lookup happens at apply time via
 * `getItem({path})` — if an item already exists at the destination,
 * the upload is skipped and the existing itemId is captured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaUploadOp, OperationIr } from "../../../src/recipe/ir/operations";
import { buildAction } from "../../../src/recipe/runtime/plan";
import { executeIr } from "../../../src/recipe/runtime/execute";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const MEDIA_REF_KEY = "44444444-4444-4444-4444-444444444444";

const externalUrlOp = (overrides: Partial<MediaUploadOp> = {}): MediaUploadOp => ({
  op: "MediaUpload",
  policy: "CreateAndUpdate",
  label: "media-upload:thumbnail:ccl-brand-template@1",
  id: MEDIA_REF_KEY,
  source: { kind: "external-url", url: "https://example.invalid/thumb.png" },
  destinationPath: "/sitecore/media library/SiteTemplates/CclBrandTemplate/thumbnail.png",
  altText: "ccl-brand thumbnail",
  ...overrides,
});

/** 1x1 transparent PNG (70 bytes). */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
);

describe("MediaUpload — planner", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(TINY_PNG, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("plans a create with media-library-relative path stripped of prefix and extension", async () => {
    const client = new MockAuthoringClient();
    const captured = new Map<string, string>();

    const action = await buildAction(0, externalUrlOp(), client, captured);

    expect(action.status).toBe("create");
    if (action.mutation?.kind !== "mediaUpload") throw new Error("expected mediaUpload mutation");
    // `/sitecore/media library/` prefix stripped; `.png` extension dropped
    // from the leaf (Sitecore stores extension on the underlying blob).
    expect(action.mutation.itemPath).toBe("SiteTemplates/CclBrandTemplate/thumbnail");
    expect(action.mutation.mediaRefKey).toBe(MEDIA_REF_KEY);
    expect(action.mutation.altText).toBe("ccl-brand thumbnail");
    expect(action.mutation.bytes.byteLength).toBe(TINY_PNG.byteLength);
    expect(action.mutation.mimeType).toBe("image/png");
  });

  it("skips re-upload when the refKey is already captured", async () => {
    const client = new MockAuthoringClient();
    const captured = new Map<string, string>([[MEDIA_REF_KEY, "existing-item-id"]]);

    const action = await buildAction(0, externalUrlOp(), client, captured);

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/already captured/);
  });

  it("errors when the URL fetch returns non-2xx", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 404, statusText: "Not Found" })
    ) as unknown as typeof globalThis.fetch;
    const client = new MockAuthoringClient();
    const captured = new Map<string, string>();

    const action = await buildAction(0, externalUrlOp(), client, captured);

    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/404/);
  });
});

describe("MediaUpload — executor end-to-end", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(TINY_PNG, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dispatches uploadMedia and captures the server-assigned itemId", async () => {
    const client = new MockAuthoringClient();
    const ir: OperationIr = {
      schemaVersion: "1",
      recipeHandle: "test-recipe@1",
      operations: [externalUrlOp()],
    };

    const result = await executeIr(ir, client, { mode: "apply" });

    expect(result.aborted).toBe(false);
    expect(result.summary.create).toBe(1);
    expect(client.mediaUploads).toHaveLength(1);
    expect(client.mediaUploads[0].itemPath).toBe("SiteTemplates/CclBrandTemplate/thumbnail");
    expect(client.mediaUploads[0].alt).toBe("ccl-brand thumbnail");
    expect(client.mediaUploads[0].overwriteExisting).toBe(true);
    // capturedItemIds carries the server-assigned media item GUID under
    // the MediaUploadOp's refKey, ready for sibling media-xml-ref refs.
    expect(result.capturedItemIds.get(MEDIA_REF_KEY)).toBeDefined();
  });

  it("short-circuits the wire upload when the destination path already exists", async () => {
    const client = new MockAuthoringClient();
    const preloadedItemId = "deadbeefdeadbeefdeadbeefdeadbeef";
    client.preload({
      itemId: preloadedItemId,
      templateId: "f1828a2c7e5d4bbd98ca320474871548",
      parentId: "",
      name: "thumbnail",
      path: "/sitecore/media library/SiteTemplates/CclBrandTemplate/thumbnail",
      fields: [],
    });
    const ir: OperationIr = {
      schemaVersion: "1",
      recipeHandle: "test-recipe@1",
      operations: [externalUrlOp()],
    };

    const result = await executeIr(ir, client, { mode: "apply" });

    expect(result.aborted).toBe(false);
    // No uploadMedia call — the dispatcher saw the existing item and
    // short-circuited.
    expect(client.mediaUploads).toHaveLength(0);
    // But capturedItemIds STILL gets seeded so downstream media-xml-ref
    // resolves correctly on a re-push.
    expect(result.capturedItemIds.get(MEDIA_REF_KEY)).toBe(preloadedItemId);
  });
});
