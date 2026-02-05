import { describe, expect, it } from "vitest";
import { collectList, normalizeArgs } from "../../../src/commands/shared";

describe("normalizeArgs", () => {
  it("expands -fr to --force", () => {
    expect(normalizeArgs(["-fr", "--other"])).toEqual(["--force", "--other"]);
  });

  it("expands -e and --env to --environment-name", () => {
    expect(normalizeArgs(["-e", "demo"])).toEqual(["-e", "demo"]);
    expect(normalizeArgs(["--env", "demo"])).toEqual(["--environment-name", "demo"]);
  });

  it("expands -q to --quiet", () => {
    expect(normalizeArgs(["-q"])).toEqual(["--quiet"]);
  });

  it("leaves other args unchanged", () => {
    expect(normalizeArgs(["-f", "-r"])).toEqual(["-f", "-r"]);
  });
});

describe("collectList", () => {
  it("splits comma-separated values and appends", () => {
    expect(collectList("a,b", ["c"])).toEqual(["c", "a", "b"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(collectList(" a, ,b ", [])).toEqual(["a", "b"]);
  });
});
