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
  it("returns true when all required scopes are present (with extras)", () => {
    const token = makeJwt({
      scope: [...AI_SKILLS_REQUIRED_SCOPES, "ai.org.docs:r", "ai.org.docs:w", "ai.org:admin"].join(
        " "
      ),
    });
    expect(hasAiSkillsScopes(token)).toBe(true);
  });

  it("returns false when any required scope is missing", () => {
    const token = makeJwt({
      scope: "ai.org.brd:r ai.orgs.br:gen", // missing ai.org.brd:w
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
  it("locks in the minimum required scope set for Brand Management + Brand Review", () => {
    // If this set changes, the operator-facing error message in
    // buildScopeMissingError + the documented Cloud Portal flow need
    // updating too. The test is the gate.
    expect([...AI_SKILLS_REQUIRED_SCOPES]).toEqual([
      "ai.org.brd:r",
      "ai.org.brd:w",
      "ai.orgs.br:gen",
    ]);
  });
});
