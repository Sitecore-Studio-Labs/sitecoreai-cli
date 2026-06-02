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

describe("toolResultFromError — summarizeError covers every ScaiErrorCode", () => {
  // Walk every code through the switch so the case branches close. The
  // `default` arm is covered by the unknown-error test above (UNKNOWN).
  const codes: Array<{ code: import("../../../src/shared/errors").ScaiErrorCode; what: RegExp }> = [
    { code: "AUTH_REQUIRED", what: /Authentication required/ },
    { code: "AUTH_DENIED", what: /MCP write tools are not permitted/ },
    { code: "POLICY_DENIED", what: /not allowed by the workspace policy/ },
    { code: "CONFIG_NOT_FOUND", what: /scai configuration was not found/ },
    { code: "CONFIG_INVALID", what: /scai configuration is invalid/ },
    { code: "INPUT_INVALID", what: /Tool input is invalid/ },
    { code: "NETWORK", what: /network call to Sitecore Cloud failed/i },
    { code: "ENV_NOT_FOUND", what: /requested environment is not configured/ },
    { code: "DEPLOY_FAILED", what: /XM Cloud Deploy operation failed/i },
    { code: "SITES_API_FAILED", what: /Sites API call failed/ },
    { code: "BRIEF_API_FAILED", what: /Brief API call failed/ },
    { code: "CANCELLED", what: /cancelled mid-flight by the client/ },
    { code: "UNKNOWN", what: /unexpected error/ },
  ];

  for (const { code, what } of codes) {
    it(`summarizes ${code} as a code-specific 'What happened' string`, () => {
      const error = createScaiError(`reason for ${code}`, code);
      const result = toolResultFromError(error);
      const structured = result.structuredContent as { code: string; what: string };
      expect(structured.code).toBe(code);
      expect(structured.what).toMatch(what);
    });
  }
});

describe("toolResultFromError — remediation override + docsUri branch", () => {
  it("leads the 'Next' line with a structured remediation (with detail) when set", () => {
    const error = createScaiError("Disk full.", "INPUT_INVALID", {
      remediation: {
        actor: "human",
        fix: "Free disk space on the runner.",
        detail: "/dev/sda1 is 99% full.",
      },
    });
    const result = toolResultFromError(error);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Free disk space on the runner. [human]");
    expect(text).toContain("/dev/sda1 is 99% full.");
    const structured = result.structuredContent as { remediation?: { actor: string } };
    expect(structured.remediation?.actor).toBe("human");
  });

  it("leads the 'Next' line with a remediation that has no detail (omits the dash separator)", () => {
    const error = createScaiError("auth invalid", "AUTH_REQUIRED", {
      remediation: { actor: "act", fix: "Refresh the token." },
    });
    const result = toolResultFromError(error);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Refresh the token. [act]");
    expect(text).not.toMatch(/Refresh the token\. \[act\] —/);
  });

  it("omits docsUri when the code doesn't map to one (e.g. NETWORK)", () => {
    const error = createScaiError("upstream failed", "NETWORK");
    const result = toolResultFromError(error);
    const structured = result.structuredContent as { docsUri?: string };
    expect(structured.docsUri).toBeUndefined();
  });

  it("includes docsUri for codes that map to one (ENV_NOT_FOUND -> manifest)", () => {
    const error = createScaiError("env x", "ENV_NOT_FOUND");
    const result = toolResultFromError(error);
    const structured = result.structuredContent as { docsUri?: string };
    expect(structured.docsUri).toBe("scai://env/current/manifest");
  });
});
