import { describe, expect, it } from "vitest";
import { ensureAllowWrite, ensureMcpElevationAllowed } from "../../../src/shared/allow-write";
import type { RootConfiguration, EnvironmentConfiguration } from "../../../src/config";

const mkRoot = (env: Partial<EnvironmentConfiguration> & { name: string }): RootConfiguration =>
  ({
    environments: { [env.name]: env as EnvironmentConfiguration },
  }) as unknown as RootConfiguration;

describe("ensureAllowWrite", () => {
  it("passes when env.allowWrite is true", () => {
    const root = mkRoot({ name: "sandbox", allowWrite: true });
    expect(() => ensureAllowWrite(root, "sandbox")).not.toThrow();
  });

  it("passes when the override (--allow-write) is true", () => {
    const root = mkRoot({ name: "prod", allowWrite: false });
    expect(() => ensureAllowWrite(root, "prod", true)).not.toThrow();
  });

  it("throws INPUT_INVALID when neither env.allowWrite nor override is set", () => {
    const root = mkRoot({ name: "prod", allowWrite: false });
    expect(() => ensureAllowWrite(root, "prod")).toThrowError(/not configured to allow writing/);
  });
});

describe("ensureMcpElevationAllowed", () => {
  it("passes by default (denyMcpElevation undefined)", () => {
    const root = mkRoot({ name: "sandbox", allowWrite: true });
    expect(() => ensureMcpElevationAllowed(root, "sandbox")).not.toThrow();
  });

  it("passes when denyMcpElevation is explicitly false", () => {
    const root = mkRoot({ name: "sandbox", denyMcpElevation: false });
    expect(() => ensureMcpElevationAllowed(root, "sandbox")).not.toThrow();
  });

  it("throws AUTH_DENIED when denyMcpElevation is true", () => {
    const root = mkRoot({ name: "prod", allowWrite: true, denyMcpElevation: true });
    expect(() => ensureMcpElevationAllowed(root, "prod")).toThrowError(/denyMcpElevation/);
  });

  it("AUTH_DENIED is a stable error code on the thrown ScaiError", () => {
    const root = mkRoot({ name: "prod", denyMcpElevation: true });
    try {
      ensureMcpElevationAllowed(root, "prod");
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as { code: string }).code).toBe("AUTH_DENIED");
    }
  });
});
