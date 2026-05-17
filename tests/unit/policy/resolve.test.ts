import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import { enrollEnvironment, resolveEffectivePolicy } from "../../../src/policy";

let policyHome: string;
let configRoot: string;
let prior: string | undefined;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scai-policy-"));
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

const env: EnvironmentConfiguration = { organizationId: "org_a", environmentId: "env_a" };

const writeRepoPolicy = (policy: unknown): void => {
  fs.writeFileSync(path.join(configRoot, "scai.policy.json"), JSON.stringify(policy));
};

describe("resolveEffectivePolicy", () => {
  it("reports unmanaged mode when no policy file exists", () => {
    const effective = resolveEffectivePolicy("staging", configRoot);
    expect(effective.managed).toBe(false);
    expect(effective.enrolled).toBe(false);
  });

  it("reports an enrolled environment as managed + enrolled at its ceiling", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    const effective = resolveEffectivePolicy("staging", configRoot);
    expect(effective.managed).toBe(true);
    expect(effective.enrolled).toBe(true);
    expect(effective.ceiling).toBe("write");
  });

  it("reports a non-enrolled environment as managed but not enrolled", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    const effective = resolveEffectivePolicy("prod", configRoot);
    expect(effective.managed).toBe(true);
    expect(effective.enrolled).toBe(false);
  });

  it("a repo policy lowers the ceiling — intersection, never union", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    writeRepoPolicy({ version: 1, environments: { staging: { ceiling: "read" } } });
    expect(resolveEffectivePolicy("staging", configRoot).ceiling).toBe("read");
  });

  it("a repo allowEnvironments list drops an environment from the allowlist", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    enrollEnvironment({ envName: "prod", environment: env, via: "policy-allow" });
    writeRepoPolicy({ version: 1, allowEnvironments: ["staging"] });
    expect(resolveEffectivePolicy("staging", configRoot).enrolled).toBe(true);
    expect(resolveEffectivePolicy("prod", configRoot).enrolled).toBe(false);
  });
});
