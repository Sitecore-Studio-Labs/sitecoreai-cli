import { describe, expect, it } from "vitest";
import {
  enrollSourceSchema,
  envIdentitySchema,
  orgIdentitySchema,
  parseRepoPolicy,
  parseWorkspacePolicy,
  policyEnvironmentSchema,
  policyOrganizationSchema,
  repoPolicySchema,
  riskTierSchema,
  workspacePolicySchema,
} from "../../../src/policy/schema";

/**
 * `parseWorkspacePolicy` / `parseRepoPolicy` are the on-disk JSON gates.
 * Both error paths wrap Zod failures into ScaiError(CONFIG_INVALID) and
 * the success path returns the parsed value. The component schemas
 * (`riskTierSchema`, `enrollSourceSchema`) close enum branches.
 */

describe("riskTierSchema + enrollSourceSchema enum closure", () => {
  for (const tier of ["read", "write", "destructive", "mint"] as const) {
    it(`accepts riskTier='${tier}'`, () => {
      expect(riskTierSchema.parse(tier)).toBe(tier);
    });
  }
  it("rejects unknown riskTier values", () => {
    expect(() => riskTierSchema.parse("admin")).toThrow();
  });

  for (const src of [
    "setup-login",
    "mcp-serve",
    "setup-init",
    "policy-init",
    "policy-allow",
  ] as const) {
    it(`accepts enrollSource='${src}'`, () => {
      expect(enrollSourceSchema.parse(src)).toBe(src);
    });
  }
  it("rejects unknown enrollSource", () => {
    expect(() => enrollSourceSchema.parse("custom")).toThrow();
  });
});

describe("envIdentitySchema + orgIdentitySchema — every field optional", () => {
  it("accepts a fully-populated env identity", () => {
    expect(
      envIdentitySchema.parse({
        organizationId: "org-1",
        projectId: "proj-1",
        environmentId: "env-1",
        host: "https://cm.example/",
      })
    ).toEqual({
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-1",
      host: "https://cm.example/",
    });
  });

  it("accepts an empty env identity (every field optional)", () => {
    expect(envIdentitySchema.parse({})).toEqual({});
  });

  it("rejects empty strings on identity fields (min(1))", () => {
    expect(() => envIdentitySchema.parse({ organizationId: "" })).toThrow();
  });

  it("orgIdentitySchema accepts just an orgId", () => {
    expect(orgIdentitySchema.parse({ organizationId: "org-x" })).toEqual({
      organizationId: "org-x",
    });
    expect(orgIdentitySchema.parse({})).toEqual({});
  });
});

describe("policyEnvironmentSchema — phase fields all optional", () => {
  const base = {
    identity: { organizationId: "org-1" },
    ceiling: "write" as const,
    enrolledAt: "2026-01-01T00:00:00Z",
    enrolledVia: "setup-login" as const,
  };

  it("accepts the minimum required shape", () => {
    expect(policyEnvironmentSchema.parse(base)).toMatchObject(base);
  });

  it("accepts mintCredentials/ciWrites/stepUpMinutes when set", () => {
    expect(
      policyEnvironmentSchema.parse({
        ...base,
        mintCredentials: true,
        ciWrites: false,
        stepUpMinutes: 15,
      }).stepUpMinutes
    ).toBe(15);
  });

  it("rejects a non-positive stepUpMinutes", () => {
    expect(() => policyEnvironmentSchema.parse({ ...base, stepUpMinutes: 0 })).toThrow();
    expect(() => policyEnvironmentSchema.parse({ ...base, stepUpMinutes: -1 })).toThrow();
  });

  it("rejects a missing ceiling", () => {
    expect(() => policyEnvironmentSchema.parse({ ...base, ceiling: undefined })).toThrow();
  });

  it("policyOrganizationSchema mirrors the same shape", () => {
    expect(
      policyOrganizationSchema.parse({
        ...base,
        identity: { organizationId: "org-1" },
      })
    ).toBeDefined();
  });
});

describe("workspacePolicySchema", () => {
  it("accepts a minimal workspace policy (no orgs, no strictOrgs)", () => {
    const policy = workspacePolicySchema.parse({
      version: 1,
      environments: {},
    });
    expect(policy.organizations).toBeUndefined();
    expect(policy.strictOrgs).toBeUndefined();
  });

  it("accepts strictOrgs + populated organizations", () => {
    const policy = workspacePolicySchema.parse({
      version: 1,
      environments: {},
      organizations: {
        "org-1": {
          identity: { organizationId: "org-1" },
          ceiling: "destructive",
          enrolledAt: "2026-01-01T00:00:00Z",
          enrolledVia: "policy-allow",
        },
      },
      strictOrgs: true,
    });
    expect(policy.strictOrgs).toBe(true);
    expect(policy.organizations?.["org-1"]?.ceiling).toBe("destructive");
  });

  it("rejects version != 1 (literal mismatch)", () => {
    expect(() => workspacePolicySchema.parse({ version: 2, environments: {} })).toThrow();
  });
});

describe("repoPolicySchema — narrow-only shape", () => {
  it("accepts an empty repo policy", () => {
    expect(repoPolicySchema.parse({ version: 1 })).toEqual({ version: 1 });
  });

  it("accepts allowEnvironments + per-env ceiling overrides", () => {
    const policy = repoPolicySchema.parse({
      version: 1,
      allowEnvironments: ["staging"],
      environments: {
        staging: { ceiling: "write", ciWrites: false },
      },
    });
    expect(policy.allowEnvironments).toEqual(["staging"]);
    expect(policy.environments?.staging?.ceiling).toBe("write");
  });

  it("accepts allowOrganizations and per-org overrides", () => {
    const policy = repoPolicySchema.parse({
      version: 1,
      allowOrganizations: ["org-prod"],
      organizations: {
        "org-prod": { stepUpMinutes: 30 },
      },
    });
    expect(policy.allowOrganizations).toEqual(["org-prod"]);
    expect(policy.organizations?.["org-prod"]?.stepUpMinutes).toBe(30);
  });
});

describe("parseWorkspacePolicy", () => {
  it("returns the parsed value on success", () => {
    const parsed = parseWorkspacePolicy(
      { version: 1, environments: {} },
      "/home/me/.sitecoreai/policy.json"
    );
    expect(parsed.version).toBe(1);
  });

  it("wraps zod failures in a CONFIG_INVALID ScaiError citing the source", () => {
    expect(() => parseWorkspacePolicy({ version: 2 }, "/p/policy.json")).toThrow(
      /Invalid workspace policy at \/p\/policy\.json/
    );
  });

  it("includes Zod issue paths in the wrapped error details", () => {
    let caught: unknown;
    try {
      parseWorkspacePolicy({ version: 1, environments: { dev: {} } }, "/p/policy.json");
    } catch (error) {
      caught = error;
    }
    expect((caught as { code: string }).code).toBe("CONFIG_INVALID");
    expect((caught as { details?: string[] }).details?.join("\n")).toMatch(/environments\.dev/);
  });

  it("emits the (root) marker when an issue has an empty path", () => {
    let caught: unknown;
    try {
      parseWorkspacePolicy(null, "/p/policy.json");
    } catch (error) {
      caught = error;
    }
    expect((caught as { details?: string[] }).details?.join("\n")).toMatch(/\(root\)/);
  });
});

describe("parseRepoPolicy", () => {
  it("returns parsed value on success", () => {
    const parsed = parseRepoPolicy(
      { version: 1, allowEnvironments: ["dev"] },
      "/r/scai.policy.json"
    );
    expect(parsed.allowEnvironments).toEqual(["dev"]);
  });

  it("wraps zod failures in CONFIG_INVALID + a 'may only narrow' hint", () => {
    let caught: unknown;
    try {
      parseRepoPolicy({ version: 99 }, "/r/scai.policy.json");
    } catch (error) {
      caught = error;
    }
    const e = caught as { code: string; hint?: string; message: string };
    expect(e.code).toBe("CONFIG_INVALID");
    expect(e.hint).toMatch(/may only narrow the workspace policy/);
    expect(e.message).toMatch(/Invalid repo policy at \/r\/scai\.policy\.json/);
  });

  it("rejects invalid ceiling values inside per-env overrides", () => {
    expect(() =>
      parseRepoPolicy(
        { version: 1, environments: { dev: { ceiling: "super-admin" } } },
        "/r/scai.policy.json"
      )
    ).toThrow(/Invalid repo policy/);
  });
});
