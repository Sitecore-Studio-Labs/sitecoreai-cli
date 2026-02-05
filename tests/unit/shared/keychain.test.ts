import { describe, expect, it, vi } from "vitest";

describe("keychain helpers", () => {
  it("returns defaults when keytar is unavailable", async () => {
    vi.resetModules();
    vi.doMock("keytar", () => {
      throw new Error("missing");
    });
    const keychain = await import("../../../src/shared/keychain");
    expect(await keychain.getDeployToken("demo")).toBeUndefined();
    expect(await keychain.setDeployToken("demo", "token")).toBe(false);
    expect(await keychain.clearDeployToken("demo")).toBe(false);
    expect(await keychain.getCmTokens("demo")).toBeUndefined();
  });

  it("parses cm tokens and clears them", async () => {
    vi.resetModules();
    vi.doMock("keytar", () => ({
      default: {
        getPassword: vi
          .fn()
          .mockResolvedValueOnce("not-json")
          .mockResolvedValueOnce(JSON.stringify({ accessToken: "token" })),
        setPassword: vi.fn().mockResolvedValue(undefined),
        deletePassword: vi.fn().mockResolvedValue(true),
      },
    }));
    const keychain = await import("../../../src/shared/keychain");
    expect(await keychain.getCmTokens("demo")).toBeUndefined();
    const tokens = await keychain.getCmTokens("demo");
    expect(tokens?.accessToken).toBe("token");
    expect(await keychain.setCmTokens("demo", { accessToken: "token" })).toBe(true);
    expect(await keychain.clearCmTokens("demo")).toBe(true);
  });
});
