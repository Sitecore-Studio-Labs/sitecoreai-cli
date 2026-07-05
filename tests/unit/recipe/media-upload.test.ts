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

    const action = await buildAction({
      index: 0,
      op: externalUrlOp(),
      client,
      capturedItemIds: captured,
    });

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

  // Sitecore's MediaCreator picks the media item's template (Image / Jpeg /
  // Movie / Pdf / … vs the generic File) from the uploaded FILENAME's
  // extension — the multipart content type plays no part. The planner must
  // therefore always hand the executor a fileName with a real extension.
  describe("upload filename extension → media template selection", () => {
    const actionFor = async (url: string, contentType: string) => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(TINY_PNG, {
            status: 200,
            headers: { "content-type": contentType },
          })
      ) as unknown as typeof globalThis.fetch;
      const action = await buildAction({
        index: 0,
        op: externalUrlOp({ source: { kind: "external-url", url } }),
        client: new MockAuthoringClient(),
        capturedItemIds: new Map(),
      });
      if (action.mutation?.kind !== "mediaUpload") throw new Error("expected mediaUpload mutation");
      return action.mutation;
    };

    it("derives the extension from Content-Type when the URL path has none (dicebear-style)", async () => {
      // `/svg` is a path segment, not an extension — without the
      // Content-Type fallback this uploaded as extensionless and landed
      // on the File template instead of Image.
      const mutation = await actionFor(
        "https://api.dicebear.com/9.x/bottts/svg?seed=ai-chat",
        "image/svg+xml; charset=utf-8"
      );
      expect(mutation.fileName).toBe("thumbnail.svg");
      expect(mutation.mimeType).toBe("image/svg+xml");
    });

    it("prefers the URL path's own extension when it has one", async () => {
      // S3-style hosts commonly serve images as application/octet-stream;
      // the `.jpg` in the path is the better signal.
      const mutation = await actionFor(
        "https://cdn.example.invalid/photos/hero.JPG",
        "application/octet-stream"
      );
      expect(mutation.fileName).toBe("thumbnail.jpg");
    });

    it("maps non-image media types too (video/mp4 → .mp4)", async () => {
      const mutation = await actionFor("https://cdn.example.invalid/render?id=42", "video/mp4");
      expect(mutation.fileName).toBe("thumbnail.mp4");
      expect(mutation.mimeType).toBe("video/mp4");
    });

    it("falls back to .bin when neither URL nor Content-Type identifies the type", async () => {
      const mutation = await actionFor(
        "https://cdn.example.invalid/blob",
        "application/octet-stream"
      );
      expect(mutation.fileName).toBe("thumbnail.bin");
    });

    it("names the file after the destination leaf, not the URL tail", async () => {
      const mutation = await actionFor(
        "https://cdn.example.invalid/f8a91c/download.png",
        "image/png"
      );
      // destination leaf is `thumbnail` (from destinationPath) — the URL's
      // opaque tail contributes only its extension.
      expect(mutation.fileName).toBe("thumbnail.png");
    });
  });

  it("skips re-upload when the refKey is already captured", async () => {
    const client = new MockAuthoringClient();
    const captured = new Map<string, string>([[MEDIA_REF_KEY, "existing-item-id"]]);

    const action = await buildAction({
      index: 0,
      op: externalUrlOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/already captured/);
  });

  it("errors when the URL fetch returns non-2xx", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 404, statusText: "Not Found" })
    ) as unknown as typeof globalThis.fetch;
    const client = new MockAuthoringClient();
    const captured = new Map<string, string>();

    const action = await buildAction({
      index: 0,
      op: externalUrlOp(),
      client,
      capturedItemIds: captured,
    });

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
    expect(client.mediaUploads[0].fileName).toBe("thumbnail.png");
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
