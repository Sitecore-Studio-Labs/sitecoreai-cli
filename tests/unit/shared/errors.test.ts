import { describe, expect, it } from "vitest";
import { ScaiError, createScaiError, toScaiError, withHint } from "../../../src/shared/errors";

describe("errors", () => {
  it("wraps non-ScaiError inputs as UNKNOWN", () => {
    const error = toScaiError(new Error("Something else happened"));
    expect(error).toBeInstanceOf(ScaiError);
    expect(error.code).toBe("UNKNOWN");
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe("Something else happened");
  });

  it("wraps non-Error values as UNKNOWN with stringified message", () => {
    const error = toScaiError("string error");
    expect(error.code).toBe("UNKNOWN");
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe("string error");
  });

  it("preserves ScaiError and applies hints", () => {
    const original = createScaiError("Bad input", "INPUT_INVALID", {
      hint: "Add required flags.",
      details: ["missing --id"],
    });
    const passedThrough = toScaiError(original);
    expect(passedThrough).toBe(original);

    const withNewHint = withHint(original, "Override hint");
    expect(withNewHint).toBeInstanceOf(ScaiError);
    expect(withNewHint.code).toBe("INPUT_INVALID");
    expect(withNewHint.exitCode).toBe(2);
    expect(withNewHint.hint).toBe("Override hint");
    expect(withNewHint.details).toEqual(["missing --id"]);
  });

  it("deprecated CliError alias still resolves to ScaiError and is instanceof-compatible", async () => {
    // Verifies the legacy alias kept for one major version. Anyone with
    // pre-rename code using `CliError` should keep working.
    const { CliError, createCliError, toCliError } = await import("../../../src/shared/errors");

    expect(CliError).toBe(ScaiError);

    const fromAlias = createCliError("legacy boom", "NETWORK");
    expect(fromAlias).toBeInstanceOf(ScaiError);
    expect(fromAlias).toBeInstanceOf(CliError);

    const wrapped = toCliError(new Error("plain"));
    expect(wrapped).toBeInstanceOf(ScaiError);
    expect(wrapped.code).toBe("UNKNOWN");
  });
});
