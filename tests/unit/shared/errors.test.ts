import { describe, expect, it } from "vitest";
import { CliError, createCliError, toCliError, withHint } from "../../../src/shared/errors";

describe("errors", () => {
  it("classifies config errors", () => {
    const notFound = toCliError(new Error("configuration file not found"));
    expect(notFound.code).toBe("CONFIG_NOT_FOUND");
    expect(notFound.exitCode).toBe(2);

    const invalid = toCliError(new Error("sitecoreai.cli.json is invalid"));
    expect(invalid.code).toBe("CONFIG_INVALID");
    expect(invalid.exitCode).toBe(2);
  });

  it("classifies environment, auth, network, deploy, and input errors", () => {
    expect(toCliError(new Error("Environment is not configured")).code).toBe("ENV_NOT_FOUND");
    expect(toCliError(new Error("Deploy API request failed")).code).toBe("DEPLOY_FAILED");
    expect(toCliError(new Error("Deploy token not found")).code).toBe("AUTH_REQUIRED");
    expect(toCliError(new Error("Request timed out")).code).toBe("NETWORK");
    expect(toCliError(new Error("Field is required")).code).toBe("INPUT_INVALID");
  });

  it("returns unknown for unclassified errors", () => {
    const error = toCliError(new Error("Something else happened"));
    expect(error.code).toBe("UNKNOWN");
    expect(error.exitCode).toBe(1);
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
