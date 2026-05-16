import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies the Deploy clients SDK routes each call to the right
 * `/api/clients/v1/*` path with the right method, body, and org
 * headers. The transport (`deployRequest`) is mocked — these are
 * routing tests, not round-trips. `withOrganizationHeaders` is the
 * real pure helper.
 */
vi.mock("../../../../src/deploy/api/common/request", () => ({
  deployRequest: vi.fn().mockResolvedValue({}),
}));

let common: typeof import("../../../../src/deploy/api/common/request");
let api: typeof import("../../../../src/deploy/api/clients");

beforeAll(async () => {
  common = await import("../../../../src/deploy/api/common/request");
  api = await import("../../../../src/deploy/api/clients");
});

beforeEach(() => {
  vi.clearAllMocks();
});

const opts = { accessToken: "token" };
const envReq = {
  name: "scai-cm-prod",
  description: "desc",
  projectId: "proj-1",
  environmentId: "env-1",
};

describe("deploy clients api — mint endpoints", () => {
  it("mintCmClient POSTs /api/clients/v1/cm with the request body", async () => {
    await api.mintCmClient(opts, envReq);
    expect(common.deployRequest).toHaveBeenCalledWith(opts, "/api/clients/v1/cm", undefined, {
      method: "POST",
      body: envReq,
      headers: undefined,
    });
  });

  it("mintEdgeClient POSTs /api/clients/v1/edge", async () => {
    await api.mintEdgeClient(opts, envReq);
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/edge",
      undefined,
      expect.objectContaining({ method: "POST", body: envReq })
    );
  });

  it("mintEhBuildClient POSTs /api/clients/v1/ehbuild", async () => {
    await api.mintEhBuildClient(opts, envReq);
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/ehbuild",
      undefined,
      expect.objectContaining({ method: "POST", body: envReq })
    );
  });

  it("mintDeployClient POSTs /api/clients/v1/deploy with the name-only body", async () => {
    const req = { name: "scai-deploy", description: "org client" };
    await api.mintDeployClient(opts, req);
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/deploy",
      undefined,
      expect.objectContaining({ method: "POST", body: req })
    );
  });

  it("forwards organization headers when organizationId is given", async () => {
    await api.mintCmClient(opts, envReq, "org-9");
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/cm",
      undefined,
      expect.objectContaining({
        headers: { "x-organization-id": "org-9", "x-org-id": "org-9" },
      })
    );
  });
});

describe("deploy clients api — list endpoints", () => {
  it("listEnvironmentClients GETs /api/clients/v1/environment", async () => {
    await api.listEnvironmentClients(opts);
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/environment",
      undefined,
      { headers: undefined }
    );
  });

  it("listOrganizationClients GETs /api/clients/v1/organization with org headers", async () => {
    await api.listOrganizationClients(opts, "org-9");
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/organization",
      undefined,
      { headers: { "x-organization-id": "org-9", "x-org-id": "org-9" } }
    );
  });
});

describe("deploy clients api — delete", () => {
  it("deleteClient DELETEs /api/clients/v1/{id}", async () => {
    await api.deleteClient(opts, "client-7");
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/client-7",
      undefined,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deleteClient URL-encodes the id", async () => {
    await api.deleteClient(opts, "weird/id with space");
    expect(common.deployRequest).toHaveBeenCalledWith(
      opts,
      "/api/clients/v1/weird%2Fid%20with%20space",
      undefined,
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
