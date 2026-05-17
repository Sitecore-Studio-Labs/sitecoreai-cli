import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import {
  enrollEnvironment,
  readWorkspacePolicy,
  repinEnvironment,
  unenrollEnvironment,
} from "../../../src/policy";

let policyHome: string;
let prior: string | undefined;

beforeEach(() => {
  policyHome = fs.mkdtempSync(path.join(os.tmpdir(), "scai-policy-"));
  prior = process.env.SITECOREAI_POLICY_HOME;
  process.env.SITECOREAI_POLICY_HOME = policyHome;
});

afterEach(() => {
  if (prior === undefined) {
    delete process.env.SITECOREAI_POLICY_HOME;
  } else {
    process.env.SITECOREAI_POLICY_HOME = prior;
  }
  fs.rmSync(policyHome, { recursive: true, force: true });
});

const env: EnvironmentConfiguration = {
  organizationId: "org_a",
  projectId: "prj_a",
  environmentId: "env_a",
  host: "a.sitecorecloud.io",
};

describe("enrollEnvironment", () => {
  it("creates the policy file on first enrollment", () => {
    const result = enrollEnvironment({ envName: "staging", environment: env, via: "setup-login" });
    expect(result.created).toBe(true);
    expect(result.alreadyEnrolled).toBe(false);
    const policy = readWorkspacePolicy();
    expect(policy?.environments.staging?.identity.environmentId).toBe("env_a");
    expect(policy?.environments.staging?.ceiling).toBe("write");
    expect(policy?.environments.staging?.enrolledVia).toBe("setup-login");
  });

  it("is idempotent — re-enrolling refreshes identity but keeps ceiling and origin", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "setup-login" });
    const again = enrollEnvironment({
      envName: "staging",
      environment: { ...env, environmentId: "env_moved" },
      via: "mcp-serve",
    });
    expect(again.created).toBe(false);
    expect(again.alreadyEnrolled).toBe(true);
    const policy = readWorkspacePolicy();
    expect(policy?.environments.staging?.identity.environmentId).toBe("env_moved");
    // First enrollment wins for `enrolledVia` — re-running login must not rewrite history.
    expect(policy?.environments.staging?.enrolledVia).toBe("setup-login");
  });

  it("unenrollEnvironment removes an environment and is a no-op the second time", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "setup-login" });
    expect(unenrollEnvironment("staging")).toBe(true);
    expect(readWorkspacePolicy()?.environments.staging).toBeUndefined();
    expect(unenrollEnvironment("staging")).toBe(false);
  });

  it("repinEnvironment updates the pinned identity of an enrolled environment only", () => {
    enrollEnvironment({ envName: "staging", environment: env, via: "setup-login" });
    expect(repinEnvironment("staging", { ...env, host: "new.sitecorecloud.io" })).toBe(true);
    expect(readWorkspacePolicy()?.environments.staging?.identity.host).toBe("new.sitecorecloud.io");
    expect(repinEnvironment("absent", env)).toBe(false);
  });
});
