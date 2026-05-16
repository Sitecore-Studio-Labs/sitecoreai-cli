import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadDocument } from "../../../src/brand/documents/upload";
import type { BrandApiClientOptions } from "../../../src/brand/api/client";

/**
 * `uploadDocument` is URL-only. Local-file (`bytes`) sources have no
 * working path on the documents API — the v2 multipart `file` part is
 * server-broken and a `data:` URL is accepted but never fetched. The
 * SDK rejects `bytes` up front so callers fail with a clear error
 * instead of silently creating a doc that never processes.
 */
const fakeClient: BrandApiClientOptions = {
  orgId: "org_test",
  credential: { clientId: "cid", clientSecret: "sec", authority: "https://auth.example" } as never,
};

describe("uploadDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a local-file (bytes) source with INPUT_INVALID", async () => {
    await expect(
      uploadDocument({
        client: fakeClient,
        brandKitId: "kit-1",
        source: { kind: "bytes", bytes: Buffer.from("%PDF-1.4"), mimeType: "application/pdf" },
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects bytes without making a network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      uploadDocument({
        client: fakeClient,
        brandKitId: "kit-1",
        source: { kind: "bytes", bytes: Buffer.from("%PDF-1.4") },
      })
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
