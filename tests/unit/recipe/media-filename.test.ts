/**
 * Unit tests for the media-upload multipart filename helpers.
 *
 * The invariant under test: the multipart filename must carry a file
 * extension so Sitecore populates the media item's `Extension` field. A
 * missing extension (external-url tails without one, the `"media"` fallback)
 * is the bug these guard against.
 */
import { describe, expect, it } from "vitest";
import {
  ensureMediaFileName,
  extensionForMime,
  mimeForExtension,
  resolveMediaUpload,
} from "../../../src/recipe/api/media-filename";

describe("extensionForMime", () => {
  it("maps common image MIME types to canonical extensions", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/svg+xml")).toBe("svg");
    expect(extensionForMime("image/webp")).toBe("webp");
    expect(extensionForMime("image/gif")).toBe("gif");
  });

  it("is case-insensitive and tolerates charset params", () => {
    expect(extensionForMime("IMAGE/PNG")).toBe("png");
    expect(extensionForMime("image/svg+xml; charset=utf-8")).toBe("svg");
  });

  it("falls back to the subtype for unmapped types", () => {
    expect(extensionForMime("image/heic")).toBe("heic");
  });

  it("falls back to png when nothing usable can be derived", () => {
    expect(extensionForMime("application/octet-stream")).toBe("png");
    expect(extensionForMime("")).toBe("png");
  });
});

describe("ensureMediaFileName", () => {
  it("leaves a filename that already has an extension unchanged", () => {
    expect(ensureMediaFileName("thumbnail.png", "image/png")).toBe("thumbnail.png");
    expect(ensureMediaFileName("hero.jpg", "image/png")).toBe("hero.jpg");
  });

  it("appends a MIME-derived extension when the name has none", () => {
    // The core bug: an external-url path tail with no extension.
    expect(ensureMediaFileName("photo-abc123", "image/jpeg")).toBe("photo-abc123.jpg");
    expect(ensureMediaFileName("logo", "image/svg+xml")).toBe("logo.svg");
  });

  it("fixes the bare 'media' fallback", () => {
    expect(ensureMediaFileName("media", "image/png")).toBe("media.png");
  });

  it("does not treat a leading dot (dotfile) as an extension", () => {
    expect(ensureMediaFileName(".env", "image/png")).toBe(".env.png");
  });

  it("does not treat a trailing dot as an extension", () => {
    expect(ensureMediaFileName("name.", "image/png")).toBe("name..png");
  });
});

describe("mimeForExtension", () => {
  it("maps known image extensions to canonical MIME types", () => {
    expect(mimeForExtension("png")).toBe("image/png");
    expect(mimeForExtension("jpg")).toBe("image/jpeg");
    expect(mimeForExtension("jpeg")).toBe("image/jpeg");
    expect(mimeForExtension("svg")).toBe("image/svg+xml");
  });

  it("tolerates a leading dot and mixed case", () => {
    expect(mimeForExtension(".PNG")).toBe("image/png");
  });

  it("returns undefined for non-image / unknown extensions", () => {
    expect(mimeForExtension("pdf")).toBeUndefined();
    expect(mimeForExtension("")).toBeUndefined();
  });
});

describe("resolveMediaUpload", () => {
  it("overrides a bizarre CDN Content-Type using the file extension", () => {
    // The reported bug: external-url media whose Content-Type header is junk.
    expect(resolveMediaUpload("hero.jpg", "application/octet-stream")).toEqual({
      fileName: "hero.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("fixes both fields when the name has no extension", () => {
    // No extension → derive one from the (best-effort) MIME, then canonicalize.
    expect(resolveMediaUpload("photo-abc123", "image/jpeg")).toEqual({
      fileName: "photo-abc123.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("repairs the bare 'media' fallback to a coherent png pair", () => {
    expect(resolveMediaUpload("media", "image/png")).toEqual({
      fileName: "media.png",
      mimeType: "image/png",
    });
  });

  it("keeps the caller MIME type for non-image media (e.g. PDF)", () => {
    expect(resolveMediaUpload("brochure.pdf", "application/pdf")).toEqual({
      fileName: "brochure.pdf",
      mimeType: "application/pdf",
    });
  });
});
