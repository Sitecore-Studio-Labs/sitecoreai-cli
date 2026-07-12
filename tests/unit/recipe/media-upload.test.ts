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
import type { MediaFallback } from "../../../src/recipe/api/ref-encoding";
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

describe("MediaUpload — graceful degrade for dead external URLs", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const planWithFallbacks = async (op: MediaUploadOp) => {
    const mediaFallbacks = new Map<string, MediaFallback>();
    const action = await buildAction({
      index: 0,
      op,
      client: new MockAuthoringClient(),
      capturedItemIds: new Map(),
      mediaFallbacks,
    });
    return { action, mediaFallbacks };
  };

  it("registers a hotlink fallback (url + alt) when the external fetch fails", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 404, statusText: "Not Found" })
    ) as unknown as typeof globalThis.fetch;

    const { action, mediaFallbacks } = await planWithFallbacks(externalUrlOp());

    expect(action.status).toBe("error");
    expect(mediaFallbacks.get(MEDIA_REF_KEY)).toEqual({
      url: "https://example.invalid/thumb.png",
      alt: "ccl-brand thumbnail",
    });
  });

  it("registers a fallback when the fetch itself throws (dead host / timeout)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND example.invalid");
    }) as unknown as typeof globalThis.fetch;

    const { action, mediaFallbacks } = await planWithFallbacks(externalUrlOp());

    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/failed to source bytes \(external-url\)/);
    expect(mediaFallbacks.has(MEDIA_REF_KEY)).toBe(true);
  });

  it("does NOT register a fallback for an asset-source failure (authoring bug stays hard)", async () => {
    const { action, mediaFallbacks } = await planWithFallbacks(
      externalUrlOp({ source: { kind: "asset", path: "/nonexistent/asset/dir/missing.png" } })
    );

    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/failed to source bytes \(asset\)/);
    expect(mediaFallbacks.size).toBe(0);
  });

  it("refuses private/loopback hosts without fetching (SSRF guard) and degrades", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    for (const url of [
      "http://localhost/x.png",
      "http://127.0.0.1/x.png",
      "http://10.1.2.3/x.png",
      "http://172.16.9.9/x.png",
      "http://192.168.1.1/x.png",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/x.png",
    ]) {
      const { action, mediaFallbacks } = await planWithFallbacks(
        externalUrlOp({ source: { kind: "external-url", url } })
      );
      expect(action.status).toBe("error");
      expect(action.reason).toMatch(/SSRF guard/);
      expect(mediaFallbacks.get(MEDIA_REF_KEY)?.url).toBe(url);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects text/html responses (soft 404) and degrades", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<html>not found</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
    ) as unknown as typeof globalThis.fetch;

    const { action, mediaFallbacks } = await planWithFallbacks(externalUrlOp());

    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/text\/html/);
    expect(mediaFallbacks.has(MEDIA_REF_KEY)).toBe(true);
  });

  it("rejects responses over the size cap (declared content-length) and degrades", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(TINY_PNG, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(21 * 1024 * 1024),
          },
        })
    ) as unknown as typeof globalThis.fetch;

    const { action, mediaFallbacks } = await planWithFallbacks(externalUrlOp());

    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/exceeds the \d+-byte cap/);
    expect(mediaFallbacks.has(MEDIA_REF_KEY)).toBe(true);
  });

  // The spec's core apply-mode contract, exercised via the exact seam
  // that used to kill the push: a SetField carrying a `media-xml-ref`
  // whose producer MediaUpload failed.
  const HERO_REF = "55555555-5555-5555-5555-555555555555";
  const HERO_PATH = "/sitecore/content/Demo/Home/Data/Hero";
  const preloadHero = (client: MockAuthoringClient): void => {
    client.preload({
      itemId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      templateId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      parentId: "",
      name: "Hero",
      path: HERO_PATH,
      fields: [],
    });
  };
  const imageSetFieldIr = (mediaOp: MediaUploadOp): OperationIr => ({
    schemaVersion: "1",
    recipeHandle: "home@1",
    operations: [
      mediaOp,
      {
        op: "SetField",
        policy: "CreateAndUpdate",
        label: "page-field:home@1:en:Image",
        itemRefKey: HERO_REF,
        fieldId: "66666666-6666-6666-6666-666666666666",
        fieldName: "Image",
        language: "en",
        version: 1,
        value: { kind: "media-xml-ref", refKey: MEDIA_REF_KEY },
      },
    ],
  });

  it("apply mode: a dead external image degrades ONE field to a hotlink instead of aborting", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 410, statusText: "Gone" })
    ) as unknown as typeof globalThis.fetch;
    const client = new MockAuthoringClient();
    preloadHero(client);

    const result = await executeIr(imageSetFieldIr(externalUrlOp()), client, {
      mode: "apply",
      crossRecipeRefs: new Map([[HERO_REF, HERO_PATH]]),
    });

    // The media op fails, but the push completes — no abort, no rollback.
    expect(result.aborted).toBe(false);
    expect(result.rollback).toBeUndefined();
    expect(result.summary.error).toBe(1);
    expect(result.summary.update).toBe(1);
    // The referencing field degraded to the legacy hotlink form.
    expect(client.updates).toHaveLength(1);
    expect(client.updates[0].fields[0].value).toEqual({
      kind: "string",
      value: '<image src="https://example.invalid/thumb.png" alt="ccl-brand thumbnail" />',
    });
  });

  it("apply mode: an asset-source failure still aborts + rolls back (no fallback)", async () => {
    const client = new MockAuthoringClient();
    preloadHero(client);

    const result = await executeIr(
      imageSetFieldIr(
        externalUrlOp({ source: { kind: "asset", path: "/nonexistent/asset/missing.png" } })
      ),
      client,
      {
        mode: "apply",
        crossRecipeRefs: new Map([[HERO_REF, HERO_PATH]]),
      }
    );

    expect(result.aborted).toBe(true);
    expect(result.rollback).toBeDefined();
    expect(client.updates).toHaveLength(0);
    const last = result.plan.actions[result.plan.actions.length - 1];
    expect(last.reason).toMatch(/not in captured map/);
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
