import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScaiError } from "../../../src/shared/errors";
import {
  enforceOrganizationPolicy,
  resolveEffectiveOrganizationPolicy,
} from "../../../src/policy/organization-policy";

/**
 * Org-policy gate covers the parallel of `enforceEnvironmentPolicy` for
 * brand / brief / campaign. Three behaviours matter: unmanaged is a
 * no-op, lenient mode lets an env profile transitively enroll its org,
 * strict mode demands an explicit `organizations[orgId]` entry.
 */

let policyHome: string;
let configRoot: string;
let prior: string | undefined;

const writePolicy = (policy: unknown): void => {
  fs.writeFileSync(path.join(policyHome, "policy.json"), JSON.stringify(policy, null, 2));
};

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scai-org-policy-"));
  policyHome = path.join(root, "home");
  configRoot = path.join(root, "repo");
  fs.mkdirSync(policyHome, { recursive: true });
  fs.mkdirSync(configRoot, { recursive: true });
  prior = process.env.SITECOREAI_POLICY_HOME;
  process.env.SITECOREAI_POLICY_HOME = policyHome;
});

afterEach(() => {
  if (prior === undefined) {
    delete process.env.SITECOREAI_POLICY_HOME;
  } else {
    process.env.SITECOREAI_POLICY_HOME = prior;
  }
  fs.rmSync(path.dirname(policyHome), { recursive: true, force: true });
});

describe("resolveEffectiveOrganizationPolicy", () => {
  it("returns unmanaged when no workspace policy file exists", () => {
    const policy = resolveEffectiveOrganizationPolicy("org_a", configRoot);
    expect(policy.managed).toBe(false);
    expect(policy.enrolled).toBe(false);
    expect(policy.enrolledVia).toBeNull();
  });

  it("enrolls transitively in lenient mode when an env profile carries the orgId", () => {
    writePolicy({
      version: 1,
      environments: {
        staging: {
          identity: { organizationId: "org_a", projectId: "p", environmentId: "e" },
          ceiling: "write",
          enrolledAt: "2026-05-21T00:00:00.000Z",
          enrolledVia: "policy-allow",
        },
      },
    });
    const policy = resolveEffectiveOrganizationPolicy("org_a", configRoot);
    expect(policy.enrolled).toBe(true);
    expect(policy.enrolledVia).toBe("transitive");
    expect(policy.ceiling).toBe("write");
  });

  it("denies an org with no matching env in lenient mode", () => {
    writePolicy({
      version: 1,
      environments: {
        staging: {
          identity: { organizationId: "org_a", projectId: "p", environmentId: "e" },
          ceiling: "write",
          enrolledAt: "2026-05-21T00:00:00.000Z",
          enrolledVia: "policy-allow",
        },
      },
    });
    const policy = resolveEffectiveOrganizationPolicy("org_unknown", configRoot);
    expect(policy.managed).toBe(true);
    expect(policy.enrolled).toBe(false);
  });

  it("enrolls explicitly when an organizations[orgId] entry exists", () => {
    writePolicy({
      version: 1,
      environments: {},
      organizations: {
        org_a: {
          identity: { organizationId: "org_a" },
          ceiling: "destructive",
          enrolledAt: "2026-05-21T00:00:00.000Z",
          enrolledVia: "policy-allow",
          mintCredentials: true,
        },
      },
    });
    const policy = resolveEffectiveOrganizationPolicy("org_a", configRoot);
    expect(policy.enrolled).toBe(true);
    expect(policy.enrolledVia).toBe("explicit");
    expect(policy.ceiling).toBe("destructive");
    expect(policy.mintCredentials).toBe(true);
  });

  it("denies a transitively-enrolled org in strict mode", () => {
    writePolicy({
      version: 1,
      strictOrgs: true,
      environments: {
        staging: {
          identity: { organizationId: "org_a", projectId: "p", environmentId: "e" },
          ceiling: "write",
          enrolledAt: "2026-05-21T00:00:00.000Z",
          enrolledVia: "policy-allow",
        },
      },
    });
    const policy = resolveEffectiveOrganizationPolicy("org_a", configRoot);
    expect(policy.enrolled).toBe(false);
  });
});

describe("enforceOrganizationPolicy", () => {
  it("is a no-op in unmanaged mode", () => {
    expect(() =>
      enforceOrganizationPolicy({ orgId: "org_a", configRootDir: configRoot })
    ).not.toThrow();
  });

  it("throws POLICY_DENIED for an org not on the allowlist", () => {
    writePolicy({
      version: 1,
      strictOrgs: true,
      environments: {},
      organizations: {
        org_allowed: {
          identity: { organizationId: "org_allowed" },
          ceiling: "read",
          enrolledAt: "2026-05-21T00:00:00.000Z",
          enrolledVia: "policy-allow",
        },
      },
    });
    try {
      enforceOrganizationPolicy({ orgId: "org_blocked", configRootDir: configRoot });
      throw new Error("expected enforceOrganizationPolicy to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("POLICY_DENIED");
      expect((error as ScaiError).hint).toContain("allow-org");
    }
  });

  it("permits a transitively-enrolled org in lenient mode", () => {
    writePolicy({
      version: 1,
      environments: {
        staging: {
          identity: { organizationId: "org_a", projectId: "p", environmentId: "e" },
          ceiling: "write",
          enrolledAt: "2026-05-21T00:00:00.000Z",
          enrolledVia: "policy-allow",
        },
      },
    });
    expect(() =>
      enforceOrganizationPolicy({ orgId: "org_a", configRootDir: configRoot })
    ).not.toThrow();
  });
});
