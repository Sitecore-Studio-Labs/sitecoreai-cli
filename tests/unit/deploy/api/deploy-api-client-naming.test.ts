import { describe, expect, it } from "vitest";
import {
  SCAI_CLIENT_PREFIX,
  CLIENT_DESCRIPTION_MAX_LENGTH,
  slugifyEnvName,
  buildScaiClientName,
  buildScaiClientDescription,
  isScaiManagedClient,
  parseScaiClientName,
  type ScaiClientType,
} from "../../../../src/deploy/api/client-naming";

describe("slugifyEnvName", () => {
  it("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugifyEnvName("Production CM")).toBe("production-cm");
    expect(slugifyEnvName("my__weird..env")).toBe("my-weird-env");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyEnvName("  spaced  ")).toBe("spaced");
    expect(slugifyEnvName("--edge--")).toBe("edge");
  });
});

describe("buildScaiClientName", () => {
  it("builds env-scoped names as scai-<type>-<env>", () => {
    expect(buildScaiClientName("cm", "production")).toBe("scai-cm-production");
    expect(buildScaiClientName("edge", "Staging")).toBe("scai-edge-staging");
    expect(buildScaiClientName("ehbuild", "test")).toBe("scai-ehbuild-test");
  });

  it("builds the org-scoped deploy name without an env segment", () => {
    expect(buildScaiClientName("deploy")).toBe("scai-deploy");
    // env arg is ignored for the org-scoped type
    expect(buildScaiClientName("deploy", "whatever")).toBe("scai-deploy");
  });

  it("throws INPUT_INVALID when an env-scoped type has no usable env name", () => {
    expect(() => buildScaiClientName("cm")).toThrowError(/environment-scoped/);
    // whitespace-only slugifies to empty → also rejected
    expect(() => buildScaiClientName("edge", "   ")).toThrowError(/environment-scoped/);
    try {
      buildScaiClientName("cm");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toMatchObject({ code: "INPUT_INVALID" });
    }
  });
});

describe("buildScaiClientDescription", () => {
  it("describes an env-scoped client with the environment name", () => {
    const d = buildScaiClientDescription("cm", {
      surface: "CLI",
      version: "0.0.4",
      envName: "production",
    });
    expect(d).toBe(
      "Managed by scai CLI v0.0.4. CM client for environment 'production'. " +
        "Safe to delete if scai is unused."
    );
  });

  it("falls back to 'an environment' when envName is absent", () => {
    const d = buildScaiClientDescription("edge", {
      surface: "MCP",
      version: "1.2.3",
    });
    expect(d).toContain("Edge client for an environment.");
  });

  it("describes the org-scoped deploy client", () => {
    const d = buildScaiClientDescription("deploy", {
      surface: "SDK",
      version: "0.0.4",
    });
    expect(d).toBe(
      "Managed by scai SDK v0.0.4. Deploy client for the organization. " +
        "Safe to delete if scai is unused."
    );
  });

  it("stays within the clients API 140-char description cap", () => {
    // The Deploy clients API rejects descriptions over 140 chars — a
    // pathologically long env-profile name must not blow the cap.
    const d = buildScaiClientDescription("ehbuild", {
      surface: "CLI",
      version: "0.0.4",
      envName: "x".repeat(200),
    });
    expect(d.length).toBeLessThanOrEqual(CLIENT_DESCRIPTION_MAX_LENGTH);
    expect(d.endsWith("…")).toBe(true);
  });
});

describe("isScaiManagedClient", () => {
  it("recognizes the scai- prefix", () => {
    expect(isScaiManagedClient("scai-cm-production")).toBe(true);
    expect(isScaiManagedClient("scai-deploy")).toBe(true);
  });

  it("rejects non-scai names and nullish input", () => {
    expect(isScaiManagedClient("my-own-client")).toBe(false);
    expect(isScaiManagedClient("")).toBe(false);
    expect(isScaiManagedClient(null)).toBe(false);
    expect(isScaiManagedClient(undefined)).toBe(false);
  });
});

describe("parseScaiClientName", () => {
  it("parses env-scoped names", () => {
    expect(parseScaiClientName("scai-cm-production")).toEqual({
      type: "cm",
      envName: "production",
    });
    expect(parseScaiClientName("scai-edge-my-env")).toEqual({
      type: "edge",
      envName: "my-env",
    });
  });

  it("parses the org-scoped deploy name", () => {
    expect(parseScaiClientName("scai-deploy")).toEqual({ type: "deploy" });
  });

  it("returns null for non-scai, unknown-type, or malformed names", () => {
    expect(parseScaiClientName("my-own-client")).toBeNull();
    expect(parseScaiClientName("scai-bogus-env")).toBeNull();
    expect(parseScaiClientName("scai-cm")).toBeNull(); // env-scoped, no env segment
    expect(parseScaiClientName("scai-deploy-extra")).toBeNull(); // org-scoped, stray segment
    expect(parseScaiClientName(null)).toBeNull();
  });

  it("round-trips with buildScaiClientName", () => {
    const cases: Array<[ScaiClientType, string | undefined]> = [
      ["cm", "production"],
      ["edge", "staging"],
      ["ehbuild", "test"],
      ["deploy", undefined],
    ];
    for (const [type, env] of cases) {
      const name = buildScaiClientName(type, env);
      expect(parseScaiClientName(name)).toEqual(
        env === undefined ? { type } : { type, envName: slugifyEnvName(env) }
      );
    }
  });
});

describe("SCAI_CLIENT_PREFIX", () => {
  it("is the hyphen-form prefix", () => {
    expect(SCAI_CLIENT_PREFIX).toBe("scai-");
  });
});
