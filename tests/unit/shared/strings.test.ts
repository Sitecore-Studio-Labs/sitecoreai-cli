import { describe, expect, it } from "vitest";
import { trimEndChar, trimEdgeChar } from "../../../src/shared/strings";

describe("trimEndChar", () => {
  it("returns an empty string unchanged", () => {
    expect(trimEndChar("", "/")).toBe("");
  });

  it("trims a single trailing occurrence", () => {
    expect(trimEndChar("a/", "/")).toBe("a");
  });

  it("trims a multi-run trailing edge", () => {
    expect(trimEndChar("a////", "/")).toBe("a");
  });

  it("collapses an all-char string to empty", () => {
    expect(trimEndChar("////", "/")).toBe("");
  });

  it("leaves a string with no trailing char untouched (identity)", () => {
    const input = "/a/b";
    expect(trimEndChar(input, "/")).toBe(input);
  });

  it("preserves leading and internal occurrences", () => {
    expect(trimEndChar("/a/b/c//", "/")).toBe("/a/b/c");
  });

  it("handles a single-character string that is the trim char", () => {
    expect(trimEndChar("=", "=")).toBe("");
  });

  it("handles a single-character string that is not the trim char", () => {
    expect(trimEndChar("x", "=")).toBe("x");
  });

  it("trims base64 padding", () => {
    expect(trimEndChar("YWJj==", "=")).toBe("YWJj");
  });
});

describe("trimEdgeChar", () => {
  it("returns an empty string unchanged", () => {
    expect(trimEdgeChar("", "-")).toBe("");
  });

  it("trims both leading and trailing runs", () => {
    expect(trimEdgeChar("--a--", "-")).toBe("a");
  });

  it("trims only the leading run when there is no trailing run", () => {
    expect(trimEdgeChar("--a", "-")).toBe("a");
  });

  it("trims only the trailing run when there is no leading run", () => {
    expect(trimEdgeChar("a--", "-")).toBe("a");
  });

  it("collapses an all-char string to empty", () => {
    expect(trimEdgeChar("-----", "-")).toBe("");
  });

  it("preserves internal occurrences", () => {
    expect(trimEdgeChar("-a-b-c-", "-")).toBe("a-b-c");
  });

  it("leaves a string with no edge char untouched (identity)", () => {
    const input = "a-b";
    expect(trimEdgeChar(input, "-")).toBe(input);
  });

  it("handles a single-character string that is the trim char", () => {
    expect(trimEdgeChar("_", "_")).toBe("");
  });

  it("handles a single-character string that is not the trim char", () => {
    expect(trimEdgeChar("x", "_")).toBe("x");
  });

  it("trims underscores from a normalized env key", () => {
    expect(trimEdgeChar("__FOO_BAR__", "_")).toBe("FOO_BAR");
  });
});
