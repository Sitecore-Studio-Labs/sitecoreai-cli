/**
 * `createDeployApiClient` — the options-binding factory.
 *
 * The factory adds no transport behavior of its own; it binds a fixed
 * `DeployApiClientOptions` as the first argument of each underlying
 * function-style operation. These tests mock every underlying module so
 * each method's binding (options-first, arguments tail in order) can be
 * asserted independently of the wire.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/deploy/api/deployments", () => ({
  cancelDeployment: vi.fn().mockResolvedValue("cancelDeployment"),
  deployDeployment: vi.fn().mockResolvedValue("deployDeployment"),
  fetchDeployment: vi.fn().mockResolvedValue("fetchDeployment"),
  fetchDeploymentStatus: vi.fn().mockResolvedValue("fetchDeploymentStatus"),
  fetchDeployments: vi.fn().mockResolvedValue("fetchDeployments"),
  uploadDeploymentSource: vi.fn().mockResolvedValue("uploadDeploymentSource"),
}));
vi.mock("../../../../src/deploy/api/environments", () => ({
  createEnvironmentDeployment: vi.fn().mockResolvedValue("createEnvironmentDeployment"),
  fetchAllEnvironments: vi.fn().mockResolvedValue("fetchAllEnvironments"),
  fetchEnvironment: vi.fn().mockResolvedValue("fetchEnvironment"),
  fetchEnvironmentDeployments: vi.fn().mockResolvedValue("fetchEnvironmentDeployments"),
  fetchEnvironments: vi.fn().mockResolvedValue("fetchEnvironments"),
}));
vi.mock("../../../../src/deploy/api/logs", () => ({
  fetchLogList: vi.fn().mockResolvedValue("fetchLogList"),
}));
vi.mock("../../../../src/deploy/api/organizations", () => ({
  createOrganizationDemoSolution: vi.fn().mockResolvedValue("createOrganizationDemoSolution"),
  fetchOrganization: vi.fn().mockResolvedValue("fetchOrganization"),
  fetchOrganizationHealth: vi.fn().mockResolvedValue("fetchOrganizationHealth"),
  fetchOrganizationLicense: vi.fn().mockResolvedValue("fetchOrganizationLicense"),
}));
vi.mock("../../../../src/deploy/api/projects", () => ({
  createProject: vi.fn().mockResolvedValue("createProject"),
  fetchAllProjects: vi.fn().mockResolvedValue("fetchAllProjects"),
  fetchProject: vi.fn().mockResolvedValue("fetchProject"),
  fetchProjectEnvironments: vi.fn().mockResolvedValue("fetchProjectEnvironments"),
  fetchProjects: vi.fn().mockResolvedValue("fetchProjects"),
}));
vi.mock("../../../../src/deploy/api/source-control", () => ({
  fetchSourceControlIntegrations: vi.fn().mockResolvedValue("fetchSourceControlIntegrations"),
  fetchSourceControlRepository: vi.fn().mockResolvedValue("fetchSourceControlRepository"),
}));

let factory: typeof import("../../../../src/deploy/api/client");
let deployments: typeof import("../../../../src/deploy/api/deployments");
let environments: typeof import("../../../../src/deploy/api/environments");
let logs: typeof import("../../../../src/deploy/api/logs");
let organizations: typeof import("../../../../src/deploy/api/organizations");
let projects: typeof import("../../../../src/deploy/api/projects");
let sourceControl: typeof import("../../../../src/deploy/api/source-control");

const OPTIONS = { accessToken: "token", baseUrl: "https://deploy.example" };

beforeAll(async () => {
  factory = await import("../../../../src/deploy/api/client");
  deployments = await import("../../../../src/deploy/api/deployments");
  environments = await import("../../../../src/deploy/api/environments");
  logs = await import("../../../../src/deploy/api/logs");
  organizations = await import("../../../../src/deploy/api/organizations");
  projects = await import("../../../../src/deploy/api/projects");
  sourceControl = await import("../../../../src/deploy/api/source-control");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDeployApiClient", () => {
  it("exposes the bound options object verbatim", () => {
    const client = factory.createDeployApiClient(OPTIONS);
    expect(client.options).toBe(OPTIONS);
  });

  describe("organizations", () => {
    it("fetchOrganization binds options-only", async () => {
      const result = await factory.createDeployApiClient(OPTIONS).fetchOrganization();
      expect(organizations.fetchOrganization).toHaveBeenCalledWith(OPTIONS);
      expect(result).toBe("fetchOrganization");
    });

    it("fetchOrganizationHealth forwards the org id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchOrganizationHealth("org-1");
      expect(organizations.fetchOrganizationHealth).toHaveBeenCalledWith(OPTIONS, "org-1");
    });

    it("fetchOrganizationHealth forwards an undefined org id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchOrganizationHealth(undefined);
      expect(organizations.fetchOrganizationHealth).toHaveBeenCalledWith(OPTIONS, undefined);
    });

    it("fetchOrganizationLicense forwards the org id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchOrganizationLicense("org-1");
      expect(organizations.fetchOrganizationLicense).toHaveBeenCalledWith(OPTIONS, "org-1");
    });

    it("createOrganizationDemoSolution binds options-only", async () => {
      const result = await factory.createDeployApiClient(OPTIONS).createOrganizationDemoSolution();
      expect(organizations.createOrganizationDemoSolution).toHaveBeenCalledWith(OPTIONS);
      expect(result).toBe("createOrganizationDemoSolution");
    });
  });

  describe("projects", () => {
    it("fetchProjects forwards the query", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchProjects({ name: "x" });
      expect(projects.fetchProjects).toHaveBeenCalledWith(OPTIONS, { name: "x" });
    });

    it("fetchAllProjects forwards the page size", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchAllProjects(25);
      expect(projects.fetchAllProjects).toHaveBeenCalledWith(OPTIONS, 25);
    });

    it("fetchProject forwards the project id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchProject("proj-1");
      expect(projects.fetchProject).toHaveBeenCalledWith(OPTIONS, "proj-1");
    });

    it("createProject forwards the request body", async () => {
      await factory.createDeployApiClient(OPTIONS).createProject({ name: "New" });
      expect(projects.createProject).toHaveBeenCalledWith(OPTIONS, { name: "New" });
    });

    it("fetchProjectEnvironments forwards id and query", async () => {
      await factory
        .createDeployApiClient(OPTIONS)
        .fetchProjectEnvironments("proj-1", { PageNumber: 2 });
      expect(projects.fetchProjectEnvironments).toHaveBeenCalledWith(OPTIONS, "proj-1", {
        PageNumber: 2,
      });
    });
  });

  describe("environments", () => {
    it("fetchEnvironments forwards the query", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchEnvironments({ PageNumber: 1 });
      expect(environments.fetchEnvironments).toHaveBeenCalledWith(OPTIONS, { PageNumber: 1 });
    });

    it("fetchAllEnvironments forwards the page size", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchAllEnvironments(40);
      expect(environments.fetchAllEnvironments).toHaveBeenCalledWith(OPTIONS, 40);
    });

    it("fetchEnvironment forwards the environment id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchEnvironment("env-1");
      expect(environments.fetchEnvironment).toHaveBeenCalledWith(OPTIONS, "env-1");
    });

    it("fetchEnvironmentDeployments forwards the environment id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchEnvironmentDeployments("env-1");
      expect(environments.fetchEnvironmentDeployments).toHaveBeenCalledWith(OPTIONS, "env-1");
    });

    it("createEnvironmentDeployment forwards id and redeploy flag", async () => {
      await factory.createDeployApiClient(OPTIONS).createEnvironmentDeployment("env-1", true);
      expect(environments.createEnvironmentDeployment).toHaveBeenCalledWith(OPTIONS, "env-1", true);
    });
  });

  describe("deployments", () => {
    it("fetchDeployments forwards the query", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchDeployments({ Status: "Complete" });
      expect(deployments.fetchDeployments).toHaveBeenCalledWith(OPTIONS, {
        Status: "Complete",
      });
    });

    it("fetchDeployment forwards the deployment id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchDeployment("dep-1");
      expect(deployments.fetchDeployment).toHaveBeenCalledWith(OPTIONS, "dep-1");
    });

    it("fetchDeploymentStatus forwards the organization id", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchDeploymentStatus("org-1");
      expect(deployments.fetchDeploymentStatus).toHaveBeenCalledWith(OPTIONS, "org-1");
    });

    it("deployDeployment forwards deployment and organization ids", async () => {
      await factory.createDeployApiClient(OPTIONS).deployDeployment("dep-1", "org-1");
      expect(deployments.deployDeployment).toHaveBeenCalledWith(OPTIONS, "dep-1", "org-1");
    });

    it("cancelDeployment forwards deployment and organization ids", async () => {
      await factory.createDeployApiClient(OPTIONS).cancelDeployment("dep-1", "org-1");
      expect(deployments.cancelDeployment).toHaveBeenCalledWith(OPTIONS, "dep-1", "org-1");
    });

    it("uploadDeploymentSource forwards id and buffer content", async () => {
      const content = Buffer.from("zip-bytes");
      await factory.createDeployApiClient(OPTIONS).uploadDeploymentSource("dep-1", content);
      expect(deployments.uploadDeploymentSource).toHaveBeenCalledWith(OPTIONS, "dep-1", content);
    });
  });

  describe("logs + source control", () => {
    it("fetchLogList forwards environment id and latest flag", async () => {
      await factory.createDeployApiClient(OPTIONS).fetchLogList("env-1", true);
      expect(logs.fetchLogList).toHaveBeenCalledWith(OPTIONS, "env-1", true);
    });

    it("fetchSourceControlIntegrations binds options-only", async () => {
      const result = await factory.createDeployApiClient(OPTIONS).fetchSourceControlIntegrations();
      expect(sourceControl.fetchSourceControlIntegrations).toHaveBeenCalledWith(OPTIONS);
      expect(result).toBe("fetchSourceControlIntegrations");
    });

    it("fetchSourceControlRepository forwards query and organization id", async () => {
      await factory
        .createDeployApiClient(OPTIONS)
        .fetchSourceControlRepository({ RepositoryName: "repo" }, "org-1");
      expect(sourceControl.fetchSourceControlRepository).toHaveBeenCalledWith(
        OPTIONS,
        { RepositoryName: "repo" },
        "org-1"
      );
    });
  });
});
