import { describe, it, expect } from "vitest";
import { upsertEnvVars } from "../../../src/deploy/tasks/env-file";

describe("upsertEnvVars", () => {
  it("appends keys to an empty file", () => {
    const result = upsertEnvVars("", { A: "1", B: "2" });
    expect(result).toBe("A=1\nB=2\n");
  });

  it("replaces a matching key in place and preserves order", () => {
    const existing = "A=old\nB=keep\n";
    expect(upsertEnvVars(existing, { A: "new" })).toBe("A=new\nB=keep\n");
  });

  it("preserves comments and unmanaged vars, appends new keys", () => {
    const existing = "# my config\nUNMANAGED=x\nA=old\n";
    const result = upsertEnvVars(existing, { A: "new", B: "added" });
    expect(result).toBe("# my config\nUNMANAGED=x\nA=new\nB=added\n");
  });

  it("does not blank an existing value for a key not in the update set", () => {
    const existing = "SITECORE_EDITING_SECRET=already\n";
    const result = upsertEnvVars(existing, { NEXT_PUBLIC_DEFAULT_LANGUAGE: "en" });
    expect(result).toContain("SITECORE_EDITING_SECRET=already");
    expect(result).toContain("NEXT_PUBLIC_DEFAULT_LANGUAGE=en");
  });
});
