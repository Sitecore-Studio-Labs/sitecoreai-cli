import { describe, expect, it } from "vitest";
import { toolResultFromError } from "../../../src/mcp/errors";
import { createScaiError, ScaiError } from "../../../src/shared/errors";

describe("toolResultFromError", () => {
  it("produces a typed envelope for AUTH_REQUIRED", () => {
    const error = createScaiError("Token missing.", "AUTH_REQUIRED", {
      hint: "Run scai setup login.",
    });
    const result = toolResultFromError(error);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      code: string;
      what: string;
      why: string;
      hint: string;
      next: string;
      docsUri?: string;
    };
    expect(structured.code).toBe("AUTH_REQUIRED");
    expect(structured.what).toBe("Authentication required.");
    expect(structured.why).toBe("Token missing.");
    expect(structured.hint).toBe("Run scai setup login.");
    expect(structured.next).toMatch(/scai setup login/i);
    expect(structured.docsUri).toBe("scai://help/overview");
  });

  it("coerces unknown errors to UNKNOWN with the original message", () => {
    const result = toolResultFromError(new Error("internal failure"));
    const structured = result.structuredContent as { code: string; why: string };
    expect(structured.code).toBe("UNKNOWN");
    expect(structured.why).toBe("internal failure");
  });

  it("redacts secrets in the error text and structured content", () => {
    const error = new ScaiError("Bearer abc123secret leaked", { code: "NETWORK" });
    const result = toolResultFromError(error);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).not.toContain("abc123secret");
    expect(text).toContain("<redacted>");
    const structured = result.structuredContent as { why: string };
    expect(structured.why).not.toContain("abc123secret");
  });

  it("provides envelope-only fields (code/what/why/hint/next/docsUri)", () => {
    const error = createScaiError("Bad input.", "INPUT_INVALID");
    const result = toolResultFromError(error);
    const structured = result.structuredContent as Record<string, unknown>;
    for (const key of ["code", "exitCode", "what", "why", "next"]) {
      expect(structured).toHaveProperty(key);
    }
  });

  it("composes a 'what / why / next' text block", () => {
    const error = createScaiError("Bad input.", "INPUT_INVALID", { hint: "Pass --foo" });
    const result = toolResultFromError(error);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("What happened:");
    expect(text).toContain("Why:");
    expect(text).toContain("Next:");
  });
});
