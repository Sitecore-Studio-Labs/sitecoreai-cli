import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../../../src/shared/keychain", () => ({
  getDeployToken: vi.fn().mockResolvedValue("token"),
  setDeployToken: vi.fn().mockResolvedValue(true),
  clearDeployToken: vi.fn().mockResolvedValue(true),
  getCmTokens: vi.fn().mockResolvedValue(undefined),
  setCmTokens: vi.fn().mockResolvedValue(true),
  clearCmTokens: vi.fn().mockResolvedValue(true),
}));

const apiMocks = vi.hoisted(() => ({
  fetchOrganization: vi.fn().mockResolvedValue({ id: "org-1", name: "Org" }),
  fetchOrganizationHealth: vi.fn().mockResolvedValue({ status: "ok" }),
  fetchOrganizationLicense: vi.fn().mockResolvedValue({ key: "license" }),
  createOrganizationDemoSolution: vi.fn().mockResolvedValue({ id: "demo" }),
  fetchProjects: vi.fn().mockResolvedValue([{ id: "proj-1", name: "Project One" }]),
  fetchProjectsLimitation: vi.fn().mockResolvedValue({ limit: 1 }),
  validateProjectName: vi.fn().mockResolvedValue({ valid: true }),
  fetchProject: vi.fn().mockResolvedValue({ id: "proj-1", name: "Project One" }),
  linkProjectRepository: vi.fn().mockResolvedValue({ linked: true }),
  unlinkProjectRepository: vi.fn().mockResolvedValue({ unlinked: true }),
  createProject: vi.fn().mockResolvedValue({ id: "proj-2" }),
  updateProject: vi.fn().mockResolvedValue({ id: "proj-2" }),
  deleteProject: vi.fn().mockResolvedValue({ deleted: true }),
  fetchSourceControlIntegrations: vi.fn().mockResolvedValue([{ id: "sc-1", name: "SC" }]),
  fetchSourceControlIntegrationState: vi.fn().mockResolvedValue({ state: "ok" }),
  fetchSourceControlAccessToken: vi.fn().mockResolvedValue({ accessToken: "token" }),
  validateSourceControlIntegration: vi.fn().mockResolvedValue({ valid: true }),
  validateSourceControlRepository: vi.fn().mockResolvedValue({ valid: true }),
  fetchSourceControlRepository: vi.fn().mockResolvedValue({ id: "repo-1" }),
  fetchSourceControlRepositoryBranches: vi.fn().mockResolvedValue([{ name: "main" }]),
  fetchSourceControlTemplates: vi.fn().mockResolvedValue([{ name: "template" }]),
  createSourceControlRepository: vi.fn().mockResolvedValue({ id: "repo-2" }),
  createSourceControlRepositoryGithub: vi.fn().mockResolvedValue({ id: "repo-2" }),
  fetchSourceControlProviders: vi.fn().mockResolvedValue([{ name: "github" }]),
  fetchSourceControlIntegration: vi.fn().mockResolvedValue({ id: "sc-1" }),
  deleteSourceControlIntegration: vi.fn().mockResolvedValue({ deleted: true }),
  fetchDeployments: vi.fn().mockResolvedValue([{ id: "dep-1" }]),
  fetchDeployment: vi.fn().mockResolvedValue({ id: "dep-1" }),
  fetchDeploymentV3: vi.fn().mockResolvedValue({
    calculatedStatus: 2,
    deploymentStatus: 2,
    postActionStatus: 2,
  }),
  fetchDeploymentStatus: vi.fn().mockResolvedValue({ statuses: [] }),
  deployDeployment: vi.fn().mockResolvedValue({ id: "dep-2" }),
  cancelDeployment: vi.fn().mockResolvedValue({ canceled: true }),
  uploadDeploymentSource: vi.fn().mockResolvedValue({ uploaded: true }),
  fetchDeploymentLogs: vi.fn().mockResolvedValue({ logs: [] }),
  fetchEnvironments: vi
    .fn()
    .mockResolvedValue([{ id: "env-1", name: "Env One", projectType: "cm" }]),
  fetchEnvironmentsLimitation: vi.fn().mockResolvedValue({ limit: 1 }),
  fetchEnvironment: vi
    .fn()
    .mockImplementation((_options, id: string) =>
      Promise.resolve(
        id === "eh-1"
          ? { id, name: "Editing Host", type: "eh", projectId: "proj-1", tenantType: 0 }
          : { id, name: "Env One", type: "cm", projectId: "proj-1", tenantType: 0 }
      )
    ),
  fetchEnvironmentDeployments: vi.fn().mockResolvedValue([{ id: "dep-1" }]),
  createEnvironmentDeployment: vi.fn().mockResolvedValue({ id: "dep-2" }),
  fetchEnvironmentVariables: vi.fn().mockResolvedValue([{ name: "VAR" }]),
  upsertEnvironmentVariable: vi.fn().mockResolvedValue({ ok: true }),
  deleteEnvironmentVariable: vi.fn().mockResolvedValue({ ok: true }),
  fetchEnvironmentEdgeToken: vi.fn().mockResolvedValue({ token: "edge" }),
  fetchEnvironmentEditingSecret: vi.fn().mockResolvedValue({ secret: "edit" }),
  regenerateEnvironmentContext: vi.fn().mockResolvedValue({ ok: true }),
  fetchProjectEnvironments: vi.fn().mockResolvedValue([{ id: "env-1", name: "Env One" }]),
  createProjectEnvironment: vi.fn().mockResolvedValue({ id: "env-2" }),
  deleteEnvironment: vi.fn().mockResolvedValue({ deleted: true }),
  updateEnvironment: vi.fn().mockResolvedValue({ updated: true }),
  linkEnvironmentRepository: vi.fn().mockResolvedValue({ linked: true }),
  unlinkEnvironmentRepository: vi.fn().mockResolvedValue({ unlinked: true }),
  fetchEnvironmentRestartStatus: vi.fn().mockResolvedValue({ status: "ok" }),
  restartEnvironment: vi.fn().mockResolvedValue({ restarted: true }),
  resolveHostFromEnvironment: vi.fn().mockResolvedValue("https://cm"),
  fetchLogList: vi.fn().mockResolvedValue([{ fileName: "log.txt" }]),
  fetchLogFile: vi.fn().mockResolvedValue({ buffer: Buffer.from("log") }),
  promoteEnvironmentDeployment: vi.fn().mockResolvedValue({ promoted: true }),
}));

vi.mock("../../../../src/deploy/api", () => ({
  ...apiMocks,
  DeployEnvironment: {},
  DeployProject: {},
}));

describe("deploy task runners", () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-tasks-"));
    const modulePath = path.join(rootDir, "module.module.json");
    await fs.writeFile(
      modulePath,
      JSON.stringify(
        {
          namespace: "demo",
          items: {
            path: "demo",
            includes: [{ name: "Root", path: "/sitecore/content", scope: "singleItem" }],
          },
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(rootDir, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          envProfiles: {
            demo: {
              name: "demo",
              organizationId: "org-1",
              projectId: "proj-1",
              environmentId: "env-1",
            },
          },
          defaultEnvProfile: "demo",
        },
        null,
        2
      ),
      "utf8"
    );
  });

  afterAll(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("runs deploy commands without throwing", async () => {
    const tasks = await import("../../../../src/serialization/tasks");
    const base = { config: rootDir, environmentName: "demo" };

    await tasks.runDeployOrganizationsGet(base);
    await tasks.runDeployOrganizationsHealth(base);
    await tasks.runDeployOrganizationsLicense(base);
    await tasks.runDeployOrganizationsLaunchDemo(base);

    await tasks.runDeployProjectsList(base);
    await tasks.runDeployProjectsLimitation(base);
    await tasks.runDeployProjectsValidateName({ ...base, name: "Project One" });
    await tasks.runDeployProjectsGet({ ...base, id: "proj-1" });
    await tasks.runDeployProjectsCreate({ ...base, name: "New Project" });
    await tasks.runDeployProjectsUpdate({ ...base, id: "proj-1", newName: "New Name" });
    await tasks.runDeployProjectsLinkRepository({
      ...base,
      id: "proj-1",
      repositoryName: "repo",
      repositoryId: "repo-1",
      integrationId: "sc-1",
      repositoryRelativePath: "/",
    });
    await tasks.runDeployProjectsUnlinkRepository({ ...base, id: "proj-1" });
    await tasks.runDeployProjectsDelete({ ...base, id: "proj-1", force: true });

    await tasks.runDeploySourceControlList(base);
    await tasks.runDeploySourceControlState(base);
    await tasks.runDeploySourceControlAccessToken({ ...base, id: "sc-1" });
    await tasks.runDeploySourceControlValidate({ ...base, id: "sc-1" });
    await tasks.runDeploySourceControlRepositoryGet({
      ...base,
      integrationId: "sc-1",
      repositoryId: "repo-1",
    });
    await tasks.runDeploySourceControlRepositoryBranches({
      ...base,
      integrationId: "sc-1",
      repositoryName: "repo",
    });
    await tasks.runDeploySourceControlRepositoryValidate({
      ...base,
      integrationId: "sc-1",
      repositoryName: "repo",
    });
    await tasks.runDeploySourceControlRepositoryCreateFromTemplate({
      ...base,
      provider: "github",
      templateRepository: "template",
      templateOwner: "owner",
      repositoryName: "repo",
      owner: "owner",
      integrationId: "sc-1",
    });
    await tasks.runDeploySourceControlProviders(base);
    await tasks.runDeploySourceControlTemplates({ ...base, provider: "github" });
    await tasks.runDeploySourceControlGet({ ...base, id: "sc-1" });
    await tasks.runDeploySourceControlDelete({ ...base, id: "sc-1", force: true });

    await tasks.runDeployDeploymentsList({ ...base, status: "Active" });
    await tasks.runDeployDeploymentsGet({ ...base, id: "dep-1" });
    await tasks.runDeployDeploymentsStatus(base);
    await tasks.runDeployDeploymentsDeploy({ ...base, id: "dep-1" });
    await tasks.runDeployDeploymentsCancel({ ...base, id: "dep-1" });

    const tempFile = path.join(rootDir, "source.zip");
    await fs.writeFile(tempFile, "zip", "utf8");
    await tasks.runDeployDeploymentsSource({ ...base, id: "dep-1", file: tempFile });

    await tasks.runDeployDeploymentsWatch({ ...base, id: "dep-1" });
    await tasks.runDeployDeploymentLogs({
      ...base,
      id: "dep-1",
      output: path.join(rootDir, "dep-logs.json"),
    });

    await tasks.runDeployEnvironmentsList({ ...base, type: "cm" });
    await tasks.runDeployEnvironmentsLimitation(base);
    await tasks.runDeployEnvironmentsGet({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsCreate({
      ...base,
      project: "proj-1",
      name: "Env Two",
      tenantType: 0,
    });
    await tasks.runDeployEnvironmentsVariablesList({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsVariablesCreate({
      ...base,
      id: "env-1",
      variable: "KEY",
      value: "VALUE",
    });
    await tasks.runDeployEnvironmentsVariablesDelete({
      ...base,
      id: "env-1",
      variable: "KEY",
    });
    await tasks.runDeployEnvironmentsDeploymentsList({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsDeploymentsCreate({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsGetEdgeToken({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsGetEditingSecret({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsRegenerateContext({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsPromote({
      ...base,
      id: "env-1",
      sourceId: "dep-1",
      noStart: true,
    });
    await tasks.runDeployEnvironmentsRestart({ ...base, id: "env-1", force: true });
    await tasks.runDeployEnvironmentsLinkRepository({
      ...base,
      id: "env-1",
      repositoryName: "repo",
      repositoryId: "repo-1",
      integrationId: "sc-1",
      repositoryRelativePath: "/",
      repositoryBranch: "main",
    });
    await tasks.runDeployEnvironmentsUnlinkRepository({ ...base, id: "env-1" });
    await tasks.runDeployEnvironmentsDelete({ ...base, id: "env-1", force: true });

    await tasks.runDeployLogsList({ ...base, id: "env-1", latest: true });
    await tasks.runDeployLogsView({ ...base, id: "env-1", log: "log.txt" });
    await tasks.runDeployLogsData({
      ...base,
      id: "env-1",
      log: "log.txt",
      output: path.join(rootDir, "env-log.txt"),
    });

    await tasks.runDeployEditingHostList({ ...base, project: "proj-1" });
    await tasks.runDeployEditingHostCreate({ ...base, cmEnvironmentId: "env-1", name: "eh" });
    await tasks.runDeployEditingHostUpdate({ ...base, id: "eh-1", name: "eh" });
    await tasks.runDeployEditingHostDeploy({
      ...base,
      id: "eh-1",
      redeploy: true,
      noWatch: true,
    });
    await tasks.runDeployEditingHostDelete({ ...base, id: "eh-1", force: true });

    expect(apiMocks.fetchProjects).toHaveBeenCalled();
  });

  it("validates required deploy options", async () => {
    const tasks = await import("../../../../src/serialization/tasks");
    const base = { config: rootDir, environmentName: "demo" };

    await expect(tasks.runDeployProjectsCreate(base)).rejects.toThrow();
    await expect(tasks.runDeployProjectsUpdate(base)).rejects.toThrow();
    await expect(tasks.runDeployProjectsDelete(base)).rejects.toThrow();
    await expect(tasks.runDeploySourceControlAccessToken(base)).rejects.toThrow();
    await expect(tasks.runDeployDeploymentsDeploy(base)).rejects.toThrow();
    await expect(tasks.runDeployDeploymentsWatch(base)).rejects.toThrow();
  });

  it("watches deployments until completion", async () => {
    const tasks = await import("../../../../src/serialization/tasks");
    const base = { config: rootDir, environmentName: "demo" };
    apiMocks.fetchDeploymentV3
      .mockResolvedValueOnce({
        calculatedStatus: 1,
        deploymentStatus: 1,
        postActionStatus: 1,
      })
      .mockResolvedValueOnce({
        calculatedStatus: 2,
        deploymentStatus: 2,
        postActionStatus: 2,
      });
    vi.useFakeTimers();
    const promise = tasks.runDeployDeploymentsWatch({
      ...base,
      id: "dep-1",
      waitForPostActions: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    vi.useRealTimers();
  });
});
