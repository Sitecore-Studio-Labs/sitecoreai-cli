import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isHeadAppRepo } from "../../../src/setup/bootstrap";

describe("isHeadAppRepo", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-headapp-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects a Content SDK dependency in package.json", () => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@sitecore-content-sdk/nextjs": "^2.1.0" } })
    );
    expect(isHeadAppRepo(dir)).toBe(true);
  });

  it("detects a head app by xmcloud.build.json when no matching dependency", () => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { next: "15" } })
    );
    fs.writeFileSync(path.join(dir, "xmcloud.build.json"), "{}");
    expect(isHeadAppRepo(dir)).toBe(true);
  });

  it("returns false for an unrelated directory", () => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { express: "4" } })
    );
    expect(isHeadAppRepo(dir)).toBe(false);
  });

  it("does not throw on a malformed package.json and falls back to file signals", () => {
    fs.writeFileSync(path.join(dir, "package.json"), "{ not json");
    expect(isHeadAppRepo(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, "sitecore.config.ts"), "export default {}");
    expect(isHeadAppRepo(dir)).toBe(true);
  });
});
