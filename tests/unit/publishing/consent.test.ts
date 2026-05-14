import { describe, expect, it } from "vitest";
import type { PublishAuditScope } from "../../../src/publishing/audit";
import {
  computeScopeHash,
  mintScopeToken,
  SCOPE_TOKEN_TTL_MS,
  verifyScopeToken,
} from "../../../src/publishing/consent";

const baseScope: PublishAuditScope = {
  envName: "sandbox",
  resolvedTenantId: "tenant-abc",
  target: "Edge",
  kind: "item",
  itemIds: ["00000000-0000-0000-0000-000000000001"],
  path: "/sitecore/content/Home",
  languages: ["en-US"],
};

describe("computeScopeHash", () => {
  it("produces a 32-char hex digest", () => {
    const hash = computeScopeHash(baseScope);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is stable across runs for the same scope", () => {
    expect(computeScopeHash(baseScope)).toBe(computeScopeHash({ ...baseScope }));
  });

  it("is insensitive to itemIds order", () => {
    const a = { ...baseScope, itemIds: ["a", "b", "c"] };
    const b = { ...baseScope, itemIds: ["c", "b", "a"] };
    expect(computeScopeHash(a)).toBe(computeScopeHash(b));
  });

  it("is insensitive to languages order", () => {
    const a = { ...baseScope, languages: ["en-US", "fr-CA"] };
    const b = { ...baseScope, languages: ["fr-CA", "en-US"] };
    expect(computeScopeHash(a)).toBe(computeScopeHash(b));
  });

  it("changes when env name differs", () => {
    expect(computeScopeHash(baseScope)).not.toBe(
      computeScopeHash({ ...baseScope, envName: "prod" })
    );
  });

  it("changes when kind differs (item vs full)", () => {
    expect(computeScopeHash(baseScope)).not.toBe(
      computeScopeHash({ ...baseScope, kind: "full" })
    );
  });

  it("changes when an item is added", () => {
    expect(computeScopeHash(baseScope)).not.toBe(
      computeScopeHash({ ...baseScope, itemIds: [...(baseScope.itemIds ?? []), "extra"] })
    );
  });

  it("treats undefined and false includeSubitems / includeRelated identically", () => {
    const a: PublishAuditScope = { ...baseScope };
    const b: PublishAuditScope = {
      ...baseScope,
      includeSubitems: false,
      includeRelated: false,
    };
    expect(computeScopeHash(a)).toBe(computeScopeHash(b));
  });
});

describe("mintScopeToken / verifyScopeToken", () => {
  const NOW = 1_700_000_000_000;

  it("mints a `pub_`-prefixed token", () => {
    const token = mintScopeToken(baseScope, NOW);
    expect(token.startsWith("pub_")).toBe(true);
  });

  it("verifies a fresh token against identical scope", () => {
    const token = mintScopeToken(baseScope, NOW);
    const result = verifyScopeToken(token, baseScope, NOW + 1000);
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed token", () => {
    const result = verifyScopeToken("not-a-real-token", baseScope, NOW);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token missing the pub_ prefix", () => {
    const result = verifyScopeToken("abc123", baseScope, NOW);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an expired token", () => {
    const token = mintScopeToken(baseScope, NOW);
    const result = verifyScopeToken(token, baseScope, NOW + SCOPE_TOKEN_TTL_MS + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("expired");
    }
  });

  it("rejects a token with mismatched env name", () => {
    const token = mintScopeToken(baseScope, NOW);
    const result = verifyScopeToken(token, { ...baseScope, envName: "prod" }, NOW + 100);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "env-mismatch") {
      expect(result.tokenEnv).toBe("sandbox");
      expect(result.expectedEnv).toBe("prod");
    }
  });

  it("rejects a token with mismatched kind (item vs full)", () => {
    const token = mintScopeToken({ ...baseScope, kind: "item" }, NOW);
    const result = verifyScopeToken(token, { ...baseScope, kind: "full" }, NOW + 100);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "kind-mismatch") {
      expect(result.tokenKind).toBe("item");
      expect(result.expectedKind).toBe("full");
    }
  });

  it("rejects a token when scope has drifted (e.g. extra item added)", () => {
    const token = mintScopeToken(baseScope, NOW);
    const drifted = {
      ...baseScope,
      itemIds: [...(baseScope.itemIds ?? []), "new-item"],
    };
    const result = verifyScopeToken(token, drifted, NOW + 100);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "scope-mismatch") {
      expect(result.tokenHash).not.toBe(result.expectedHash);
    }
  });

  it("accepts a token when itemIds order changed but content didn't", () => {
    const a = { ...baseScope, itemIds: ["a", "b", "c"] };
    const b = { ...baseScope, itemIds: ["c", "b", "a"] };
    const token = mintScopeToken(a, NOW);
    expect(verifyScopeToken(token, b, NOW + 100).ok).toBe(true);
  });
});
