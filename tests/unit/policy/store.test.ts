import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `readWorkspacePolicy` / `readRepoPolicy` / `writeWorkspacePolicy` /
 * `isManaged` — sync FS gateways. Branches:
 *
 *  - resolveUserPolicyPath returns null (Vitest default) → read = null,
 *    write = null, isManaged = false
 *  - SITECOREAI_POLICY_HOME set + file absent → null
 *  - file present + valid JSON + valid schema → parsed
 *  - file present + invalid JSON → CONFIG_INVALID (JSON branch)
 *  - file present + valid JSON but unreadable shape → CONFIG_INVALID (schema branch)
 *  - unreadable file (permission / ENOENT-on-readFile) → CONFIG_INVALID (read branch)
 *  - writeWorkspacePolicy creates the parent dir + atomic temp-then-rename
 */

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scai-policy-test-"));
  originalHome = process.env.SITECOREAI_POLICY_HOME;
  process.env.SITECOREAI_POLICY_HOME = tmpHome;
});

afterEach(async () => {
  await fs.promises.rm(tmpHome, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env.SITECOREAI_POLICY_HOME;
  } else {
    process.env.SITECOREAI_POLICY_HOME = originalHome;
  }
});

const writePolicy = (body: unknown): string => {
  const file = path.join(tmpHome, "policy.json");
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
};

describe("readWorkspacePolicy", () => {
  it("returns null when no policy file exists (unmanaged mode)", async () => {
    const { readWorkspacePolicy } = await import("../../../src/policy/store");
    expect(readWorkspacePolicy()).toBeNull();
  });

  it("returns null when SITECOREAI_POLICY_HOME is unset under Vitest (no policy dir)", async () => {
    delete process.env.SITECOREAI_POLICY_HOME;
    const { readWorkspacePolicy } = await import("../../../src/policy/store");
    expect(readWorkspacePolicy()).toBeNull();
  });

  it("parses a valid policy file", async () => {
    writePolicy({ version: 1, environments: {} });
    const { readWorkspacePolicy } = await import("../../../src/policy/store");
    const policy = readWorkspacePolicy();
    expect(policy?.version).toBe(1);
  });

  it("throws CONFIG_INVALID when the JSON is malformed", async () => {
    fs.writeFileSync(path.join(tmpHome, "policy.json"), "{not json");
    const { readWorkspacePolicy } = await import("../../../src/policy/store");
    expect(() => readWorkspacePolicy()).toThrow(/is not valid JSON/);
  });

  it("throws CONFIG_INVALID when the file is valid JSON but fails schema validation", async () => {
    writePolicy({ version: 2 });
    const { readWorkspacePolicy } = await import("../../../src/policy/store");
    expect(() => readWorkspacePolicy()).toThrow(/Invalid workspace policy/);
  });

  it("throws CONFIG_INVALID when the policy file is unreadable (read branch)", async () => {
    // Simulate the read-error branch by pointing SITECOREAI_POLICY_HOME at
    // a path where policy.json is in fact a directory — readFileSync
    // rejects with EISDIR.
    fs.mkdirSync(path.join(tmpHome, "policy.json"));
    const { readWorkspacePolicy } = await import("../../../src/policy/store");
    expect(() => readWorkspacePolicy()).toThrow(/Unable to read/);
  });
});

describe("readRepoPolicy", () => {
  it("returns null when no scai.policy.json exists in the config dir", async () => {
    const { readRepoPolicy } = await import("../../../src/policy/store");
    expect(readRepoPolicy(tmpHome)).toBeNull();
  });

  it("parses a valid repo policy file", async () => {
    fs.writeFileSync(
      path.join(tmpHome, "scai.policy.json"),
      JSON.stringify({ version: 1, allowEnvironments: ["dev"] })
    );
    const { readRepoPolicy } = await import("../../../src/policy/store");
    const policy = readRepoPolicy(tmpHome);
    expect(policy?.allowEnvironments).toEqual(["dev"]);
  });

  it("throws CONFIG_INVALID when the repo policy fails schema", async () => {
    fs.writeFileSync(path.join(tmpHome, "scai.policy.json"), JSON.stringify({ version: 99 }));
    const { readRepoPolicy } = await import("../../../src/policy/store");
    expect(() => readRepoPolicy(tmpHome)).toThrow(/Invalid repo policy/);
  });
});

describe("writeWorkspacePolicy + isManaged", () => {
  it("returns null and writes nothing when no policy dir resolves", async () => {
    delete process.env.SITECOREAI_POLICY_HOME;
    const { writeWorkspacePolicy, isManaged } = await import("../../../src/policy/store");
    expect(writeWorkspacePolicy({ version: 1, environments: {} })).toBeNull();
    expect(isManaged()).toBe(false);
  });

  it("writes the policy atomically and returns the path", async () => {
    const { writeWorkspacePolicy, readWorkspacePolicy } = await import("../../../src/policy/store");
    const written = writeWorkspacePolicy({ version: 1, environments: {} });
    expect(written).toBe(path.join(tmpHome, "policy.json"));
    expect(fs.existsSync(written!)).toBe(true);
    const round = readWorkspacePolicy();
    expect(round?.version).toBe(1);
  });

  it("creates the parent directory if it doesn't yet exist (mkdir recursive branch)", async () => {
    const nested = path.join(tmpHome, "nested", "subdir");
    process.env.SITECOREAI_POLICY_HOME = nested;
    const { writeWorkspacePolicy } = await import("../../../src/policy/store");
    const written = writeWorkspacePolicy({ version: 1, environments: {} });
    expect(written).toBe(path.join(nested, "policy.json"));
    expect(fs.existsSync(written!)).toBe(true);
  });

  it("isManaged returns true when the policy file exists", async () => {
    writePolicy({ version: 1, environments: {} });
    const { isManaged } = await import("../../../src/policy/store");
    expect(isManaged()).toBe(true);
  });

  it("isManaged returns false when SITECOREAI_POLICY_HOME points at a dir without a policy file", async () => {
    const { isManaged } = await import("../../../src/policy/store");
    expect(isManaged()).toBe(false);
  });
});
