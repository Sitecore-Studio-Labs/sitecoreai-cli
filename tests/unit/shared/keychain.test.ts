import { describe, expect, it, vi } from "vitest";

describe("keychain helpers", () => {
  it("returns defaults when the keyring module is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", () => {
      throw new Error("missing");
    });
    const keychain = await import("../../../src/shared/keychain");
    expect(await keychain.getDeployToken("demo")).toBeUndefined();
    expect(await keychain.setDeployToken("demo", "token")).toBe(false);
    expect(await keychain.clearDeployToken("demo")).toBe(false);
    expect(await keychain.getCmTokens("demo")).toBeUndefined();
  });

  it("parses cm tokens and clears them via AsyncEntry", async () => {
    vi.resetModules();
    // First call returns invalid JSON (safeParse → undefined); second returns
    // a valid bundle. The mock shares one getPassword across AsyncEntry
    // instances so the chained returns line up with sequential calls.
    const getPassword = vi
      .fn()
      .mockResolvedValueOnce("not-json")
      .mockResolvedValueOnce(JSON.stringify({ accessToken: "token" }));
    const setPassword = vi.fn().mockResolvedValue(undefined);
    const deleteCredential = vi.fn().mockResolvedValue(true);
    vi.doMock("@napi-rs/keyring", () => ({
      // Explicit ES class so `new AsyncEntry(...)` constructs correctly across
      // vitest versions. The methods delegate to the shared mock fns so the
      // chained mockResolvedValueOnce returns advance across instances.
      AsyncEntry: class {
        getPassword() {
          return getPassword();
        }
        setPassword(password: string) {
          return setPassword(password);
        }
        deleteCredential() {
          return deleteCredential();
        }
      },
    }));
    const keychain = await import("../../../src/shared/keychain");
    expect(await keychain.getCmTokens("demo")).toBeUndefined();
    const tokens = await keychain.getCmTokens("demo");
    expect(tokens?.accessToken).toBe("token");
    expect(await keychain.setCmTokens("demo", { accessToken: "token" })).toBe(true);
    expect(await keychain.clearCmTokens("demo")).toBe(true);
  });

  it("round-trips the CM client secret via AsyncEntry", async () => {
    vi.resetModules();
    // The keychain holds only the secret string — the non-secret
    // metadata lives in the config file (see docs/credentials.md).
    const secret = "secret-xyz";
    const getPassword = vi.fn().mockResolvedValue(secret);
    const setPassword = vi.fn().mockResolvedValue(undefined);
    const deleteCredential = vi.fn().mockResolvedValue(true);
    vi.doMock("@napi-rs/keyring", () => ({
      AsyncEntry: class {
        getPassword() {
          return getPassword();
        }
        setPassword(password: string) {
          return setPassword(password);
        }
        deleteCredential() {
          return deleteCredential();
        }
      },
    }));
    const keychain = await import("../../../src/shared/keychain");
    expect(await keychain.getCmClientSecret("demo")).toBe(secret);
    expect(await keychain.setCmClientSecret("demo", secret)).toBe(true);
    expect(setPassword).toHaveBeenCalledWith(secret);
    expect(await keychain.clearCmClientSecret("demo")).toBe(true);
  });

  it("returns undefined for the CM client secret when the keyring is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", () => {
      throw new Error("missing");
    });
    const keychain = await import("../../../src/shared/keychain");
    expect(await keychain.getCmClientSecret("demo")).toBeUndefined();
    expect(await keychain.setCmClientSecret("demo", "s")).toBe(false);
    expect(await keychain.clearCmClientSecret("demo")).toBe(false);
  });
});
