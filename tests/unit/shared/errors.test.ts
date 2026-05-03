import { describe, expect, it } from "vitest";
import { CliError, createCliError, toCliError, withHint } from "../../../src/shared/errors";

describe("errors", () => {
  it("wraps non-CliError inputs as UNKNOWN", () => {
    const error = toCliError(new Error("Something else happened"));
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe("UNKNOWN");
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe("Something else happened");
  });

  it("wraps non-Error values as UNKNOWN with stringified message", () => {
    const error = toCliError("string error");
    expect(error.code).toBe("UNKNOWN");
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe("string error");
  });

  it("preserves CliError and applies hints", () => {
    const original = createCliError("Bad input", "INPUT_INVALID", {
      hint: "Add required flags.",
      details: ["missing --id"],
    });
    const passedThrough = toCliError(original);
    expect(passedThrough).toBe(original);

    const withNewHint = withHint(original, "Override hint");
    expect(withNewHint).toBeInstanceOf(CliError);
    expect(withNewHint.code).toBe("INPUT_INVALID");
    expect(withNewHint.exitCode).toBe(2);
    expect(withNewHint.hint).toBe("Override hint");
    expect(withNewHint.details).toEqual(["missing --id"]);
  });
});
