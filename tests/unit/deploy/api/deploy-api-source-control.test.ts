import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/deploy/api/common/request", () => ({
  deployRequest: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../../src/deploy/api/common/headers", () => ({
  withOrganizationHeaders: vi.fn((id?: string) =>
    id ? { "x-organization-id": id, "x-org-id": id } : undefined
  ),
}));

let request: typeof import("../../../../src/deploy/api/common/request");
let headers: typeof import("../../../../src/deploy/api/common/headers");
let api: typeof import("../../../../src/deploy/api/source-control");
const common = {
  get deployRequest() {
    return request.deployRequest;
  },
  get withOrganizationHeaders() {
    return headers.withOrganizationHeaders;
  },
};

beforeAll(async () => {
  request = await import("../../../../src/deploy/api/common/request");
  headers = await import("../../../../src/deploy/api/common/headers");
  api = await import("../../../../src/deploy/api/source-control");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("source-control api", () => {
  it("fetchSourceControlIntegrations lists integrations", async () => {
    await api.fetchSourceControlIntegrations({ accessToken: "token" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v2/integrations"
    );
  });

  it("fetchSourceControlIntegrationState uses org headers", async () => {
    await api.fetchSourceControlIntegrationState({ accessToken: "token" }, "org-1");
    expect(common.withOrganizationHeaders).toHaveBeenCalledWith("org-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/integration/state",
      undefined,
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("fetchSourceControlAccessToken passes IntegrationId query", async () => {
    await api.fetchSourceControlAccessToken({ accessToken: "token" }, "int-1", "org-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/accesstoken",
      { IntegrationId: "int-1" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("validateSourceControlIntegration passes query", async () => {
    await api.validateSourceControlIntegration(
      { accessToken: "token" },
      { integrationId: "int-1" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v2/integration/validate",
      { IntegrationId: "int-1" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("validateSourceControlIntegration accepts IntegrationId and id fields", async () => {
    await api.validateSourceControlIntegration(
      { accessToken: "token" },
      { IntegrationId: "int-2" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v2/integration/validate",
      { IntegrationId: "int-2" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );

    await api.validateSourceControlIntegration({ accessToken: "token" }, { id: "int-3" }, "org-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v2/integration/validate",
      { IntegrationId: "int-3" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("validateSourceControlRepository passes query", async () => {
    await api.validateSourceControlRepository(
      { accessToken: "token" },
      { repositoryName: "repo" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v2/repository/validate",
      { RepositoryName: "repo", IntegrationId: undefined },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("validateSourceControlRepository accepts RepositoryName and IntegrationId", async () => {
    await api.validateSourceControlRepository(
      { accessToken: "token" },
      { RepositoryName: "repo-two", IntegrationId: "int-2" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v2/repository/validate",
      { RepositoryName: "repo-two", IntegrationId: "int-2" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("fetchSourceControlRepository lists repositories", async () => {
    await api.fetchSourceControlRepository(
      { accessToken: "token" },
      { IntegrationId: "int-1" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/repository",
      { IntegrationId: "int-1" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("fetchSourceControlRepositoryBranches encodes repository name", async () => {
    await api.fetchSourceControlRepositoryBranches(
      { accessToken: "token" },
      "my repo",
      { IntegrationId: "int-1" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/my%20repo/branches",
      { IntegrationId: "int-1" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("fetchSourceControlTemplates passes provider query", async () => {
    await api.fetchSourceControlTemplates(
      { accessToken: "token" },
      { provider: "github" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/templates",
      { provider: "github" },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("createSourceControlRepository posts repository body", async () => {
    await api.createSourceControlRepository(
      { accessToken: "token" },
      { repositoryName: "repo" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/repository",
      undefined,
      {
        method: "POST",
        body: { repositoryName: "repo" },
        headers: { "x-organization-id": "org-1", "x-org-id": "org-1" },
      }
    );
  });

  it("createSourceControlRepositoryGithub posts repository body", async () => {
    await api.createSourceControlRepositoryGithub(
      { accessToken: "token" },
      { repositoryName: "repo" },
      "org-1"
    );
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/repository/github",
      undefined,
      {
        method: "POST",
        body: { repositoryName: "repo" },
        headers: { "x-organization-id": "org-1", "x-org-id": "org-1" },
      }
    );
  });

  it("fetchSourceControlProviders lists providers", async () => {
    await api.fetchSourceControlProviders({ accessToken: "token" }, "org-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/providers",
      undefined,
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("fetchSourceControlIntegration gets by id", async () => {
    await api.fetchSourceControlIntegration({ accessToken: "token" }, "int-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/integration/int-1"
    );
  });

  it("deleteSourceControlIntegration deletes by id", async () => {
    await api.deleteSourceControlIntegration({ accessToken: "token" }, "int-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/sourcecontrol/v1/integration/int-1",
      undefined,
      { method: "DELETE" }
    );
  });
});
