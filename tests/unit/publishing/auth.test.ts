import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";

vi.mock("../../../src/shared/keychain", () => ({
  getDeployToken: vi.fn(),
  getPublishingToken: vi.fn(),
  setPublishingToken: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../src/auth/client-credentials", () => ({
  requestClientCredentialsToken: vi.fn(),
}));

import { acquirePublishingToken } from "../../../src/publishing/api/auth";
import {
  getDeployToken,
  getPublishingToken,
  setPublishingToken,
} from "../../../src/shared/keychain";
import { requestClientCredentialsToken } from "../../../src/auth/client-credentials";

const mockGetPublishing = getPublishingToken as unknown as ReturnType<typeof vi.fn>;
const mockGetDeploy = getDeployToken as unknown as ReturnType<typeof vi.fn>;
const mockSetPublishing = setPublishingToken as unknown as ReturnType<typeof vi.fn>;
const mockMint = requestClientCredentialsToken as unknown as ReturnType<typeof vi.fn>;

const b64url = (obj: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

/** Forge a minimal JWT with the given scope claim + exp. */
const fakeJwt = (scopes: string[], expSecondsFromNow = 3600): string =>
  `${b64url({ alg: "none" })}.${b64url({
    scope: scopes.join(" "),
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  })}.sig`;

const SCOPES = ["xmcpub.jobs.t:r", "xmcpub.jobs.t:w", "xmcpub.queue:r"];

const env: EnvironmentConfiguration = {
  name: "agents",
  clientId: "id",
  clientSecret: "secret",
  authority: "https://auth.example",
} as EnvironmentConfiguration;

beforeEach(() => {
  mockGetPublishing.mockReset();
  mockGetDeploy.mockReset();
  mockSetPublishing.mockReset();
  mockMint.mockReset();
});

describe("acquirePublishingToken — cache + freshness behavior", () => {
  it("returns the cached publishing token when it has scopes and isn't near expiry", async () => {
    const token = fakeJwt(SCOPES, 3600);
    mockGetPublishing.mockResolvedValue(token);
    const out = await acquirePublishingToken({ envName: "agents", environment: env });
    expect(out).toBe(token);
    expect(mockMint).not.toHaveBeenCalled();
  });

  it("falls through to fresh mint when cached token lacks publishing scopes (stale-scope drift)", async () => {
    const stale = fakeJwt(["openid", "profile"], 3600);
    const fresh = fakeJwt(SCOPES, 3600);
    mockGetPublishing.mockResolvedValue(stale);
    mockGetDeploy.mockResolvedValue(undefined);
    mockMint.mockResolvedValue({ accessToken: fresh });

    const out = await acquirePublishingToken({ envName: "agents", environment: env });
    expect(out).toBe(fresh);
    expect(mockMint).toHaveBeenCalledOnce();
    expect(mockSetPublishing).toHaveBeenCalledWith("agents", fresh);
  });

  it("falls through to fresh mint when cached token has scopes but is inside the expiry safety margin", async () => {
    const aboutToExpire = fakeJwt(SCOPES, 30); // 30s — inside the 60s margin
    const fresh = fakeJwt(SCOPES, 3600);
    mockGetPublishing.mockResolvedValue(aboutToExpire);
    mockGetDeploy.mockResolvedValue(undefined);
    mockMint.mockResolvedValue({ accessToken: fresh });

    const out = await acquirePublishingToken({ envName: "agents", environment: env });
    expect(out).toBe(fresh);
    expect(mockMint).toHaveBeenCalledOnce();
  });

  it("falls through past the deploy token when the deploy token is also stale", async () => {
    const stalePublishing = fakeJwt(["openid"], 3600);
    const expiredDeploy = fakeJwt(SCOPES, -10); // already expired
    const fresh = fakeJwt(SCOPES, 3600);
    mockGetPublishing.mockResolvedValue(stalePublishing);
    mockGetDeploy.mockResolvedValue(expiredDeploy);
    mockMint.mockResolvedValue({ accessToken: fresh });

    const out = await acquirePublishingToken({ envName: "agents", environment: env });
    expect(out).toBe(fresh);
    expect(mockMint).toHaveBeenCalledOnce();
  });

  it("reuses the deploy token when it covers publishing scopes and isn't expired (no mint)", async () => {
    const richDeploy = fakeJwt([...SCOPES, "xmcloud.cm:admin"], 3600);
    mockGetPublishing.mockResolvedValue(undefined);
    mockGetDeploy.mockResolvedValue(richDeploy);

    const out = await acquirePublishingToken({ envName: "agents", environment: env });
    expect(out).toBe(richDeploy);
    expect(mockMint).not.toHaveBeenCalled();
  });

  it("throws scope-missing error when fresh mint returns insufficient scopes", async () => {
    mockGetPublishing.mockResolvedValue(undefined);
    mockGetDeploy.mockResolvedValue(undefined);
    mockMint.mockResolvedValue({ accessToken: fakeJwt(["xmclouddeploy.organizations:manage"]) });

    await expect(
      acquirePublishingToken({ envName: "agents", environment: env })
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("missing publishing scopes"),
    });
  });
});
