import { describe, expect, it } from "vitest";
import { ScaiError } from "../../../src/shared/errors";
import { resolveBrandOrgId } from "../../../src/brand/tasks/login";

describe("brand/tasks/login — resolveBrandOrgId", () => {
  it("returns the explicit orgId when provided (highest precedence)", () => {
    expect(resolveBrandOrgId("org_explicit", "org_from_env", "sandbox")).toBe("org_explicit");
  });

  it("falls back to the env profile's organizationId", () => {
    expect(resolveBrandOrgId(undefined, "org_from_env", "sandbox")).toBe("org_from_env");
  });

  it("throws INPUT_INVALID with an env-named hint when nothing resolves", () => {
    try {
      resolveBrandOrgId(undefined, undefined, "sandbox");
      throw new Error("expected resolveBrandOrgId to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
      expect((error as ScaiError).message).toContain("sandbox");
      expect((error as ScaiError).hint).toContain("--org-id");
    }
  });

  it("throws INPUT_INVALID without an env clause when no env is named", () => {
    try {
      resolveBrandOrgId(undefined, undefined, undefined);
      throw new Error("expected resolveBrandOrgId to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
      // No env clause when envName is undefined.
      expect((error as ScaiError).message).not.toContain("env '");
    }
  });

  it("does not call into env profile when an explicit orgId is provided (even with no env)", () => {
    expect(resolveBrandOrgId("org_explicit", undefined, undefined)).toBe("org_explicit");
  });
});
