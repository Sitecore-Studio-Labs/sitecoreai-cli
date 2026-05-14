import { describe, expect, it } from "vitest";
import {
  AI_SKILLS_REQUIRED_SCOPES,
  extractScopes,
  hasAiSkillsScopes,
} from "../../../src/brand/api/auth";

/**
 * Build a minimal JWT with the given `scope` claim. The Brand auth
 * helpers only decode the payload; the signature isn't checked, so a
 * dummy header + dummy signature suffice. Mirrors what Auth0 hands
 * back for an AI APIs key client-credentials grant.
 */
const makeJwt = (payload: Record<string, unknown>): string => {
  const b64url = (input: string): string =>
    Buffer.from(input, "utf8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return [
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    b64url(JSON.stringify(payload)),
    "sig",
  ].join(".");
};

describe("brand/api/auth — extractScopes", () => {
  it("reads the space-delimited `scope` claim", () => {
    const token = makeJwt({ scope: "ai.org.brd:r ai.org.brd:w ai.orgs.br:gen" });
    expect(extractScopes(token)).toEqual(["ai.org.brd:r", "ai.org.brd:w", "ai.orgs.br:gen"]);
  });

  it("falls back to the `scp` array claim when `scope` is absent", () => {
    const token = makeJwt({ scp: ["ai.org.brd:r", "ai.orgs.br:gen"] });
    expect(extractScopes(token)).toEqual(["ai.org.brd:r", "ai.orgs.br:gen"]);
  });

  it("returns [] for malformed tokens", () => {
    expect(extractScopes("not.a.jwt")).toEqual([]);
    expect(extractScopes("only-one-part")).toEqual([]);
    expect(extractScopes("")).toEqual([]);
  });
});

describe("brand/api/auth — hasAiSkillsScopes", () => {
  it("returns true when the required scope (Brand Review generate) is present", () => {
    const token = makeJwt({
      scope: "ai.org.brd:r ai.orgs.br:gen ai.org:admin",
    });
    expect(hasAiSkillsScopes(token)).toBe(true);
  });

  it("returns false when the Brand Review generate scope is missing", () => {
    const token = makeJwt({
      scope: "ai.org.brd:r ai.org.brd:w ai.org:admin", // no ai.orgs.br:gen
    });
    expect(hasAiSkillsScopes(token)).toBe(false);
  });

  it("returns false for a Pages/Sites automation client token (xmclouddeploy.* / xmcpub.*)", () => {
    const token = makeJwt({
      scope: "xmclouddeploy.organizations:read xmcpub.jobs.t:r xmcpub.jobs.t:w",
    });
    expect(hasAiSkillsScopes(token)).toBe(false);
  });

  it("rejects empty / malformed tokens", () => {
    expect(hasAiSkillsScopes("")).toBe(false);
    expect(hasAiSkillsScopes("garbage")).toBe(false);
  });
});

describe("brand/api/auth — AI_SKILLS_REQUIRED_SCOPES", () => {
  it("matches what scai actually needs for the operations it ships today (Brand Review only)", () => {
    // scai ships only Brand Review today; the minimum required scope
    // is `ai.orgs.br:gen`. When Brand Management primitives land,
    // they will lift this set to include `ai.org.brd:r/w`. The test
    // is the gate — bump it intentionally when adding operations.
    expect([...AI_SKILLS_REQUIRED_SCOPES]).toEqual(["ai.orgs.br:gen"]);
  });
});
