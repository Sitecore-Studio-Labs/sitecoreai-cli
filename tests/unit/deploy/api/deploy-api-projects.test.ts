import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/deploy/api/common/request", () => ({
  deployRequest: vi.fn().mockResolvedValue({}),
}));

let common: typeof import("../../../../src/deploy/api/common/request");
let api: typeof import("../../../../src/deploy/api/projects");

beforeAll(async () => {
  common = await import("../../../../src/deploy/api/common/request");
  api = await import("../../../../src/deploy/api/projects");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("projects api", () => {
  it("fetchProjects lists projects", async () => {
    await api.fetchProjects({ accessToken: "token" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v2",
      undefined
    );
  });

  it("fetchProjects forwards a query when provided", async () => {
    await api.fetchProjects({ accessToken: "token" }, { PageNumber: 2, PageSize: 25 });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v2",
      { PageNumber: 2, PageSize: 25 }
    );
  });

  it("fetchProjectsLimitation hits limitation endpoint", async () => {
    await api.fetchProjectsLimitation({ accessToken: "token" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v1/limitation"
    );
  });

  it("validateProjectName calls validate endpoint", async () => {
    await api.validateProjectName({ accessToken: "token" }, "My Project");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v2/validatename",
      { name: "My Project" }
    );
  });

  it("fetchProject gets by id", async () => {
    await api.fetchProject({ accessToken: "token" }, "proj-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v2/proj-1"
    );
  });

  it("createProject posts body", async () => {
    await api.createProject({ accessToken: "token" }, { name: "New" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v1",
      undefined,
      { method: "POST", body: { name: "New" } }
    );
  });

  it("deleteProject deletes by id", async () => {
    await api.deleteProject({ accessToken: "token" }, "proj-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v1/proj-1",
      undefined,
      { method: "DELETE" }
    );
  });

  it("updateProject updates by id", async () => {
    await api.updateProject({ accessToken: "token" }, "proj-1", { name: "Updated" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v1/proj-1",
      undefined,
      { method: "PUT", body: { name: "Updated" } }
    );
  });

  it("linkProjectRepository uses repository endpoint", async () => {
    await api.linkProjectRepository({ accessToken: "token" }, "proj-1", { repositoryId: "1" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v1/proj-1/repository",
      undefined,
      { method: "PUT", body: { repositoryId: "1" } }
    );
  });

  it("unlinkProjectRepository deletes repository link", async () => {
    await api.unlinkProjectRepository({ accessToken: "token" }, "proj-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v1/proj-1/repository",
      undefined,
      { method: "DELETE" }
    );
  });

  it("fetchProjectEnvironments lists environments for project", async () => {
    await api.fetchProjectEnvironments({ accessToken: "token" }, "proj-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v2/proj-1/environments",
      undefined
    );
  });

  it("fetchProjectEnvironments forwards a query when provided", async () => {
    await api.fetchProjectEnvironments({ accessToken: "token" }, "proj-1", {
      PageNumber: 3,
      PageSize: 25,
    });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v2/proj-1/environments",
      { PageNumber: 3, PageSize: 25 }
    );
  });

  it("fetchAllProjects walks pages until totalCount is reached", async () => {
    (common.deployRequest as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, idx) => ({ id: `p-${idx}` })),
        totalCount: 60,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 10 }, (_, idx) => ({ id: `p-${idx + 50}` })),
        totalCount: 60,
      });
    const result = await api.fetchAllProjects({ accessToken: "token" });
    expect(result.items).toHaveLength(60);
    expect(result.totalCount).toBe(60);
  });

  it("fetchAllProjectEnvironments walks pages until totalCount is reached", async () => {
    (common.deployRequest as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, idx) => ({ id: `e-${idx}` })),
        totalCount: 55,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 5 }, (_, idx) => ({ id: `e-${idx + 50}` })),
        totalCount: 55,
      });
    const result = await api.fetchAllProjectEnvironments({ accessToken: "token" }, "proj-1");
    expect(result.items).toHaveLength(55);
    expect(result.totalCount).toBe(55);
  });

  it("createProjectEnvironment posts environment body", async () => {
    await api.createProjectEnvironment({ accessToken: "token" }, "proj-1", { name: "Env" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/projects/v2/proj-1/environments",
      undefined,
      { method: "POST", body: { name: "Env" } }
    );
  });
});
