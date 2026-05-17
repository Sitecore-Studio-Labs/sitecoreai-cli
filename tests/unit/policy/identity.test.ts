import { describe, expect, it } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import { describeIdentityDrift, extractIdentity, identityMatchesPin } from "../../../src/policy";

describe("extractIdentity", () => {
  it("picks the tenant triple + host and omits absent fields", () => {
    const env: EnvironmentConfiguration = { organizationId: "org_a", host: "a.example" };
    expect(extractIdentity(env)).toEqual({ organizationId: "org_a", host: "a.example" });
  });

  it("returns an empty identity for a profile with no tenant fields", () => {
    expect(extractIdentity({})).toEqual({});
  });
});

describe("identity drift", () => {
  it("matches when every pinned field is unchanged", () => {
    const pin = { organizationId: "org_a", environmentId: "env_a" };
    expect(
      identityMatchesPin(pin, { organizationId: "org_a", environmentId: "env_a", host: "x" })
    ).toBe(true);
  });

  it("only compares fields the pin actually carries", () => {
    // The pin has no host; a host difference in the config is not drift.
    expect(
      identityMatchesPin({ organizationId: "org_a" }, { organizationId: "org_a", host: "any" })
    ).toBe(true);
  });

  it("flags a swapped environmentId as drift", () => {
    const drift = describeIdentityDrift(
      { organizationId: "org_a", environmentId: "env_a" },
      { organizationId: "org_a", environmentId: "env_b" }
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("environmentId");
  });

  it("flags a pinned field that vanished from the config as drift", () => {
    expect(identityMatchesPin({ environmentId: "env_a" }, {})).toBe(false);
  });
});
