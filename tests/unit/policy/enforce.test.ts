import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import { ScaiError } from "../../../src/shared/errors";
import { enforceEnvironmentPolicy, enrollEnvironment } from "../../../src/policy";

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

const env = (overrides: Partial<EnvironmentConfiguration> = {}): EnvironmentConfiguration => ({
  organizationId: "org_a",
  projectId: "prj_a",
  environmentId: "env_a",
  host: "a.sitecorecloud.io",
  ...overrides,
});

/** Run `fn` and report the thrown ScaiError code (or a sentinel). */
const codeOf = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof ScaiError ? error.code : "NOT_SCAI_ERROR";
  }
  return "NO_THROW";
};

describe("enforceEnvironmentPolicy", () => {
  it("is a no-op in unmanaged mode (no policy file)", () => {
    expect(() =>
      enforceEnvironmentPolicy({ envName: "prod", environment: env(), configRootDir: configRoot })
    ).not.toThrow();
  });

  it("denies an environment that is not enrolled once the workspace is managed", () => {
    enrollEnvironment({ envName: "staging", environment: env(), via: "policy-allow" });
    expect(
      codeOf(() =>
        enforceEnvironmentPolicy({ envName: "prod", environment: env(), configRootDir: configRoot })
      )
    ).toBe("POLICY_DENIED");
  });

  it("allows an enrolled environment whose identity still matches", () => {
    enrollEnvironment({ envName: "staging", environment: env(), via: "policy-allow" });
    expect(() =>
      enforceEnvironmentPolicy({
        envName: "staging",
        environment: env(),
        configRootDir: configRoot,
      })
    ).not.toThrow();
  });

  it("denies an enrolled environment whose tenant identity drifted", () => {
    enrollEnvironment({ envName: "staging", environment: env(), via: "policy-allow" });
    expect(
      codeOf(() =>
        enforceEnvironmentPolicy({
          envName: "staging",
          environment: env({ environmentId: "env_SWAPPED" }),
          configRootDir: configRoot,
        })
      )
    ).toBe("POLICY_DENIED");
  });

  it("a repo policy can narrow the allowlist", () => {
    enrollEnvironment({ envName: "staging", environment: env(), via: "policy-allow" });
    enrollEnvironment({ envName: "prod", environment: env(), via: "policy-allow" });
    fs.writeFileSync(
      path.join(configRoot, "scai.policy.json"),
      JSON.stringify({ version: 1, allowEnvironments: ["staging"] })
    );
    expect(() =>
      enforceEnvironmentPolicy({
        envName: "staging",
        environment: env(),
        configRootDir: configRoot,
      })
    ).not.toThrow();
    expect(
      codeOf(() =>
        enforceEnvironmentPolicy({ envName: "prod", environment: env(), configRootDir: configRoot })
      )
    ).toBe("POLICY_DENIED");
  });
});
