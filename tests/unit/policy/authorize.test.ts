import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import type { CallerContext, RiskTier } from "../../../src/policy";
import { ScaiError } from "../../../src/shared/errors";
import { authorizeOperation, enrollEnvironment, setEnvironmentFlags } from "../../../src/policy";

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
const human: CallerContext = { kind: "interactive-human" };
const ci: CallerContext = { kind: "ci", pipelineId: "p1" };
const m2m: CallerContext = { kind: "m2m" };
const mcp: CallerContext = { kind: "mcp" };

const codeOf = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof ScaiError ? error.code : "NOT_SCAI_ERROR";
  }
  return "NO_THROW";
};

const authorize = (tier: RiskTier, envName: string, caller: CallerContext): void =>
  authorizeOperation({ envName, configRootDir: configRoot, tier, caller });

describe("authorizeOperation", () => {
  it("the read tier is always allowed", () => {
    expect(() => authorize("read", "anything", mcp)).not.toThrow();
  });

  it("is a no-op in unmanaged mode (no policy file)", () => {
    expect(() => authorize("mint", "anything", mcp)).not.toThrow();
  });

  it("allows a write for an interactive human on a default-ceiling env", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    expect(() => authorize("write", "staging", human)).not.toThrow();
  });

  it("denies a CI write unless ciWrites is enabled for the environment", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    expect(codeOf(() => authorize("write", "staging", ci))).toBe("POLICY_DENIED");
    setEnvironmentFlags("staging", { ciWrites: true });
    expect(() => authorize("write", "staging", ci)).not.toThrow();
  });

  it("denies a write when the environment ceiling is capped at read", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    setEnvironmentFlags("staging", { ceiling: "read" });
    expect(codeOf(() => authorize("write", "staging", human))).toBe("POLICY_DENIED");
  });

  it("denies destructive operations for m2m and mcp callers", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    setEnvironmentFlags("staging", { ceiling: "destructive" });
    expect(() => authorize("destructive", "staging", human)).not.toThrow();
    expect(codeOf(() => authorize("destructive", "staging", m2m))).toBe("POLICY_DENIED");
    expect(codeOf(() => authorize("destructive", "staging", mcp))).toBe("POLICY_DENIED");
  });

  it("mint requires both mintCredentials and an interactive human", () => {
    // setup-login enrollment is mint-eligible.
    enrollEnvironment({ envName: "staging", environment: env, via: "setup-login" });
    expect(() => authorize("mint", "staging", human)).not.toThrow();
    // A non-human caller can never mint, even on a mint-eligible env.
    expect(codeOf(() => authorize("mint", "staging", ci))).toBe("POLICY_DENIED");
    expect(codeOf(() => authorize("mint", "staging", mcp))).toBe("POLICY_DENIED");
    // policy-allow enrollment is not mint-eligible — even a human is denied.
    enrollEnvironment({ envName: "other", environment: env, via: "policy-allow" });
    expect(codeOf(() => authorize("mint", "other", human))).toBe("POLICY_DENIED");
  });

  it("a repo policy can flip ciWrites off (narrowing only)", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    setEnvironmentFlags("staging", { ciWrites: true });
    fs.writeFileSync(
      path.join(configRoot, "scai.policy.json"),
      JSON.stringify({ version: 1, environments: { staging: { ciWrites: false } } })
    );
    expect(codeOf(() => authorize("write", "staging", ci))).toBe("POLICY_DENIED");
  });

  it("step-up: a destructive op needs a token minted within the policy window", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "policy-allow" });
    setEnvironmentFlags("staging", { ceiling: "destructive", stepUpMinutes: 60 });
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(() =>
      authorizeOperation({
        envName: "staging",
        configRootDir: configRoot,
        tier: "destructive",
        caller: human,
        tokenLastUpdated: fresh,
      })
    ).not.toThrow();
    expect(
      codeOf(() =>
        authorizeOperation({
          envName: "staging",
          configRootDir: configRoot,
          tier: "destructive",
          caller: human,
          tokenLastUpdated: stale,
        })
      )
    ).toBe("POLICY_DENIED");
  });

  it("step-up: missing token-freshness data fails closed when a window is set", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "setup-login" });
    setEnvironmentFlags("staging", { stepUpMinutes: 30 });
    expect(
      codeOf(() =>
        authorizeOperation({
          envName: "staging",
          configRootDir: configRoot,
          tier: "mint",
          caller: human,
        })
      )
    ).toBe("POLICY_DENIED");
  });

  it("step-up: no window set means no freshness requirement", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "setup-login" });
    expect(() =>
      authorizeOperation({
        envName: "staging",
        configRootDir: configRoot,
        tier: "mint",
        caller: human,
      })
    ).not.toThrow();
  });
});
