import { describe, expect, it } from "vitest";
import { extensionForMediaMimeType, mediaMimeTypeForPath } from "../../../src/shared/media-types";

/**
 * Internal media-type table — replaced the external `mime` package after
 * its ESM-only v4 twice shipped an ERR_REQUIRE_ESM break to strict-CJS
 * consumers. These tests pin the behaviors the media-upload planner
 * relies on (including parity quirks like image/jpeg → "jpeg").
 */

describe("mediaMimeTypeForPath", () => {
  it("maps common media extensions, case-insensitively", () => {
    expect(mediaMimeTypeForPath("/assets/logo.png")).toBe("image/png");
    expect(mediaMimeTypeForPath("C:\\assets\\Hero.JPG")).toBe("image/jpeg");
    expect(mediaMimeTypeForPath("brand.svg")).toBe("image/svg+xml");
    expect(mediaMimeTypeForPath("clip.mov")).toBe("video/quicktime");
    expect(mediaMimeTypeForPath("spec.pdf")).toBe("application/pdf");
  });

  it("returns null for missing/unknown extensions and dotfiles (caller keeps its default)", () => {
    expect(mediaMimeTypeForPath("/assets/logo")).toBeNull();
    expect(mediaMimeTypeForPath("/assets/archive.xyz")).toBeNull();
    expect(mediaMimeTypeForPath("/assets/.gitignore")).toBeNull();
  });
});

describe("extensionForMediaMimeType", () => {
  it("returns the preferred extension, matching the old mime.getExtension outputs", () => {
    // image/jpeg → "jpeg" (not "jpg") — keeps uploaded file names
    // byte-stable across the library → internal-table swap.
    expect(extensionForMediaMimeType("image/jpeg")).toBe("jpeg");
    expect(extensionForMediaMimeType("image/png")).toBe("png");
    expect(extensionForMediaMimeType("video/quicktime")).toBe("mov");
    expect(extensionForMediaMimeType("image/vnd.microsoft.icon")).toBe("ico");
  });

  it("tolerates a charset suffix and mixed casing", () => {
    expect(extensionForMediaMimeType("image/svg+xml; charset=utf-8")).toBe("svg");
    expect(extensionForMediaMimeType("Image/PNG")).toBe("png");
  });

  it("returns null for unknown types (caller falls back to bin)", () => {
    expect(extensionForMediaMimeType("application/x-unknown")).toBeNull();
    expect(extensionForMediaMimeType("")).toBeNull();
  });
});
