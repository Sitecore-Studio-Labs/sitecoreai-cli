import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

const fetchOrganization = vi.fn();
const fetchProjects = vi.fn();
const fetchProject = vi.fn();
const fetchProjectEnvironments = vi.fn();
const fetchEnvironment = vi.fn();
const createProjectEnvironment = vi.fn();
const resolveHostFromEnvironment = vi.fn();

vi.mock("../../../src/deploy/api", () => ({
  fetchOrganization: (...args: unknown[]) => fetchOrganization(...args),
  fetchProjects: (...args: unknown[]) => fetchProjects(...args),
  fetchProject: (...args: unknown[]) => fetchProject(...args),
  fetchProjectEnvironments: (...args: unknown[]) => fetchProjectEnvironments(...args),
  fetchEnvironment: (...args: unknown[]) => fetchEnvironment(...args),
  createProjectEnvironment: (...args: unknown[]) => createProjectEnvironment(...args),
  resolveHostFromEnvironment: (...args: unknown[]) => resolveHostFromEnvironment(...args),
}));

const promptText = vi.fn();
const promptConfirm = vi.fn();
vi.mock("../../../src/shared/prompt", () => ({
  promptText: (...args: unknown[]) => promptText(...args),
  promptConfirm: (...args: unknown[]) => promptConfirm(...args),
}));

describe("resolveDeployLookup", () => {
  let resolveDeployLookup: (typeof import("../../../src/setup/init/deploy-lookup"))["resolveDeployLookup"];

  beforeAll(async () => {
    ({ resolveDeployLookup } = await import("../../../src/setup/init/deploy-lookup"));
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws when deploy token is missing", async () => {
    await expect(
      resolveDeployLookup({
        options: {},
        runWizard: false,
        deployToken: undefined,
        updated: {},
        existing: {},
        baseEnv: {},
        host: undefined,
        projectSelection: undefined,
        environmentSelection: undefined,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("Deploy API access token is required");
  });

  it("resolves org/project/env and host when lookups succeed", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([
      { id: "proj-1", name: "Project One" },
      { id: "proj-2", name: "Project Two" },
    ]);
    fetchProjectEnvironments.mockResolvedValue([
      { id: "env-cm", name: "CM", environmentType: "cm", tenantId: "tenant-1" },
      { id: "env-eh", name: "EH", environmentType: "eh" },
    ]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    resolveHostFromEnvironment.mockReturnValue("https://cm.host");

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: false,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "Project One",
      environmentSelection: "env-cm",
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.host).toBe("https://cm.host");
    expect(updated).toMatchObject({
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-cm",
      tenantId: "tenant-1",
      environmentType: "cm",
      editingHostEnvironmentIds: ["env-eh"],
    });
  });

  it("uses wizard selections and CM environments when available", async () => {
    fetchOrganization.mockResolvedValue({ organizationId: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([
      { id: "proj-1", name: "Project One" },
      { id: "proj-2", name: "Project Two" },
    ]);
    fetchProjectEnvironments.mockResolvedValue([
      { id: "env-cm-1", name: "CM One", environmentType: "cm", tenantId: "tenant-1" },
      { id: "env-cm-2", name: "CM Two", environmentType: "cm" },
      { id: "env-eh", name: "EH", environmentType: "eh" },
    ]);
    fetchProject.mockResolvedValue({ id: "proj-2", repositoryId: "repo-2" });
    resolveHostFromEnvironment.mockReturnValue("https://cm.host");
    promptText.mockResolvedValueOnce("2").mockResolvedValueOnce("1");

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: undefined,
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.host).toBe("https://cm.host");
    expect(fetchProjectEnvironments).toHaveBeenCalledWith({ accessToken: "token" }, "proj-2");
    expect(updated).toMatchObject({
      organizationId: "org-1",
      projectId: "proj-2",
      environmentId: "env-cm-1",
      tenantId: "tenant-1",
      environmentType: "cm",
      editingHostEnvironmentIds: ["env-eh"],
    });
    expect(promptText).toHaveBeenCalledWith("Project (number or id/name)");
    expect(promptText).toHaveBeenCalledWith("Environment (CM) (number or id/name)");
  });

  it("auto-selects the only CM environment in wizard mode and announces it by name", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProjectEnvironments.mockResolvedValue([
      { id: "env-cm", name: "CM Only", environmentType: "cm", tenantId: "tenant-1" },
      { id: "env-eh", name: "EH", environmentType: "eh" },
    ]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    resolveHostFromEnvironment.mockReturnValue("https://cm.host");

    const info = vi.fn();
    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: undefined,
      environmentSelection: undefined,
      logger: { info, warn: vi.fn() },
    });

    expect(result.host).toBe("https://cm.host");
    expect(updated).toMatchObject({ environmentId: "env-cm", environmentType: "cm" });
    // The single environment is auto-selected without a prompt...
    expect(promptText).not.toHaveBeenCalled();
    // ...but the wizard names which environment it locked onto.
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Using the only CM environment in 'Project One': CM Only (env-cm)"),
      "cyan"
    );
  });

  it("keeps provided host and skips non CM/EH environment types", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProjectEnvironments.mockResolvedValue([
      { id: "env-xp", name: "XP", environmentType: "xp" },
    ]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    resolveHostFromEnvironment.mockReturnValue("https://computed.host");

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: false,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: "https://existing.host",
      projectSelection: "proj-1",
      environmentSelection: "env-xp",
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.host).toBe("https://existing.host");
    expect(resolveHostFromEnvironment).not.toHaveBeenCalled();
    expect(updated).toMatchObject({
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-xp",
      tenantId: "tenant-1",
    });
    expect(updated).not.toHaveProperty("environmentType");
    expect(updated).not.toHaveProperty("editingHostEnvironmentIds");
  });

  it("falls back to environment ID prompt when lookup fails", async () => {
    fetchOrganization.mockRejectedValue(new Error("boom"));
    promptText.mockResolvedValue("env-fallback");
    fetchEnvironment.mockResolvedValue({
      id: "env-fallback",
      projectId: "proj-9",
      tenantId: "tenant-9",
      environmentType: "cm",
    });
    resolveHostFromEnvironment.mockReturnValue("https://fallback.host");

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: undefined,
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.host).toBe("https://fallback.host");
    expect(updated).toMatchObject({
      environmentId: "env-fallback",
      projectId: "proj-9",
      tenantId: "tenant-9",
      environmentType: "cm",
    });
    expect(promptText).toHaveBeenCalled();
  });

  it("rethrows lookup errors when not running wizard", async () => {
    fetchOrganization.mockRejectedValue(new Error("boom"));
    await expect(
      resolveDeployLookup({
        options: {},
        runWizard: false,
        deployToken: "token",
        updated: {},
        existing: {},
        baseEnv: {},
        host: undefined,
        projectSelection: undefined,
        environmentSelection: undefined,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("boom");
    expect(promptText).not.toHaveBeenCalled();
  });

  it("uses existing environment id when lookup fails in wizard mode", async () => {
    fetchOrganization.mockRejectedValue(new Error("boom"));
    fetchEnvironment.mockResolvedValue({
      id: "env-existing",
      projectId: "",
      tenantId: "tenant-2",
      environmentType: "eh",
    });
    resolveHostFromEnvironment.mockReturnValue("https://env.host");

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: { environmentId: "env-existing" },
      baseEnv: { environmentId: "env-base" },
      host: undefined,
      projectSelection: undefined,
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.host).toBe("https://env.host");
    expect(fetchEnvironment).toHaveBeenCalledWith({ accessToken: "token" }, "env-existing");
    expect(promptText).not.toHaveBeenCalled();
    expect(updated).toMatchObject({
      environmentId: "env-existing",
      tenantId: "tenant-2",
      environmentType: "eh",
    });
    expect(updated.projectId).toBeUndefined();
  });

  it("errors when wizard fallback does not receive an environment id", async () => {
    fetchOrganization.mockRejectedValue(new Error("boom"));
    promptText.mockResolvedValue("");

    await expect(
      resolveDeployLookup({
        options: {},
        runWizard: true,
        deployToken: "token",
        updated: {},
        existing: {},
        baseEnv: {},
        host: undefined,
        projectSelection: undefined,
        environmentSelection: undefined,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("Environment ID is required for environment-scoped credentials.");
  });

  it("creates a combined environment when CM-only is rejected", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    fetchProjectEnvironments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "env-new", name: "Env", environmentType: "combined" }]);
    createProjectEnvironment.mockResolvedValue({
      id: "env-new",
      name: "Env",
      environmentType: "combined",
      tenantId: "tenant-1",
    });
    resolveHostFromEnvironment.mockReturnValue("https://combined.host");
    promptConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    promptText.mockResolvedValueOnce("Env").mockResolvedValueOnce("nonprod");

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "proj-1",
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(createProjectEnvironment).toHaveBeenCalledWith({ accessToken: "token" }, "proj-1", {
      name: "Env",
      tenantType: 0,
      type: "combined",
    });
    expect(result.host).toBe("https://combined.host");
  });

  it("prompts for an environment ID when project lacks a repository", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProject.mockResolvedValue({ id: "proj-1" });
    fetchProjectEnvironments.mockResolvedValue([]);
    fetchEnvironment.mockResolvedValue({
      id: "env-2",
      projectId: "proj-2",
      tenantId: "tenant-2",
      environmentType: "cm",
    });
    resolveHostFromEnvironment.mockReturnValue("https://env.host");
    promptConfirm.mockResolvedValue(false);
    promptText.mockResolvedValue("env-2");

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "proj-1",
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(fetchEnvironment).toHaveBeenCalledWith({ accessToken: "token" }, "env-2");
    expect(updated).toMatchObject({
      environmentId: "env-2",
      projectId: "proj-2",
      tenantId: "tenant-2",
      environmentType: "cm",
    });
    expect(result.host).toBe("https://env.host");
  });

  it("throws when a non-wizard run finds a project with zero environments", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProjectEnvironments.mockResolvedValue([]);

    await expect(
      resolveDeployLookup({
        options: {},
        runWizard: false,
        deployToken: "token",
        updated: {},
        existing: {},
        baseEnv: {},
        host: undefined,
        projectSelection: "proj-1",
        environmentSelection: undefined,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("No environments were returned for project 'Project One'");
  });

  it("treats a project with a repository object as repo-linked (no env-ID prompt)", async () => {
    // hasProjectRepository follows the nested-object branch.
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProject.mockResolvedValue({
      id: "proj-1",
      repository: { id: "repo-7", name: "the repo" },
    });
    fetchProjectEnvironments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "env-new", name: "Env", environmentType: "cm" }]);
    createProjectEnvironment.mockResolvedValue({
      id: "env-new",
      name: "Env",
      environmentType: "cm",
      tenantId: "tenant-1",
    });
    resolveHostFromEnvironment.mockReturnValue("https://made.host");
    promptConfirm.mockResolvedValueOnce(true); // create one now? yes
    promptConfirm.mockResolvedValueOnce(true); // CM-only? yes
    promptText.mockResolvedValueOnce("Env").mockResolvedValueOnce("prod");

    const updated = {};
    await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "proj-1",
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    // CM-only=yes → type "cm"; tenant "prod" → tenantType 1.
    expect(createProjectEnvironment).toHaveBeenCalledWith({ accessToken: "token" }, "proj-1", {
      name: "Env",
      tenantType: 1,
      type: "cm",
    });
  });

  it("re-prompts for the tenant type until a valid value is given", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    fetchProjectEnvironments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "env-new", environmentType: "cm" }]);
    createProjectEnvironment.mockResolvedValue({ id: "env-new", environmentType: "cm" });
    resolveHostFromEnvironment.mockReturnValue("https://made.host");
    promptConfirm.mockResolvedValueOnce(true); // create one now? yes
    promptConfirm.mockResolvedValueOnce(true); // CM-only? yes
    const warn = vi.fn();
    promptText
      .mockResolvedValueOnce("Env") // name
      .mockResolvedValueOnce("garbage") // invalid tenant type
      .mockResolvedValueOnce("nonprod"); // valid

    await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated: {},
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "proj-1",
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn },
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Invalid tenant type"));
    expect(createProjectEnvironment).toHaveBeenCalledWith(
      { accessToken: "token" },
      "proj-1",
      expect.objectContaining({ tenantType: 0, type: "cm" })
    );
  });

  it("warns and routes to the env-ID fallback when environment creation fails (single project)", async () => {
    // Creation failure for a single project rethrows from the inner
    // catch, gets re-caught by the outer wizard handler, and lands in the
    // environment-ID fallback prompt.
    fetchOrganization.mockResolvedValue({ id: "org-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    fetchProjectEnvironments.mockResolvedValue([]);
    createProjectEnvironment.mockRejectedValue(new Error("creation exploded"));
    fetchEnvironment.mockResolvedValue({
      id: "env-fb",
      projectId: "proj-1",
      tenantId: "tenant-1",
      environmentType: "cm",
    });
    resolveHostFromEnvironment.mockReturnValue("https://fb.host");
    promptConfirm.mockResolvedValueOnce(true); // create one now? yes
    promptConfirm.mockResolvedValueOnce(true); // CM-only? yes
    const warn = vi.fn();
    promptText
      .mockResolvedValueOnce("Env") // name
      .mockResolvedValueOnce("nonprod") // tenant type
      .mockResolvedValueOnce("env-fb"); // env-ID fallback

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "proj-1",
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn },
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Environment creation failed. creation exploded")
    );
    expect(result.host).toBe("https://fb.host");
    expect(updated).toMatchObject({ environmentId: "env-fb" });
  });

  it("requires an environment name when the create-environment prompt is empty", async () => {
    // The empty-name inputError is thrown inside the outer try; in wizard
    // mode it is re-caught and routed to the env-ID fallback, which itself
    // errors out when no environment ID is provided.
    fetchOrganization.mockResolvedValue({ id: "org-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    fetchProjectEnvironments.mockResolvedValue([]);
    promptConfirm.mockResolvedValueOnce(true); // create one now? yes
    promptText
      .mockResolvedValueOnce("") // empty name -> inner inputError
      .mockResolvedValueOnce(""); // env-ID fallback also empty

    await expect(
      resolveDeployLookup({
        options: {},
        runWizard: true,
        deployToken: "token",
        updated: {},
        existing: {},
        baseEnv: {},
        host: undefined,
        projectSelection: "proj-1",
        environmentSelection: undefined,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("Environment ID is required for environment-scoped credentials");
  });

  it("rethrows the empty-name error verbatim in non-wizard mode", async () => {
    // With runWizard=false the outer catch rethrows, so the inner
    // "Environment name is required" error surfaces unmodified — but
    // creation only runs in wizard mode, so the non-wizard variant hits
    // the "no environments" guard instead. This pins that guard message.
    fetchOrganization.mockResolvedValue({ id: "org-1" });
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProjectEnvironments.mockResolvedValue([]);

    await expect(
      resolveDeployLookup({
        options: {},
        runWizard: false,
        deployToken: "token",
        updated: {},
        existing: {},
        baseEnv: {},
        host: undefined,
        projectSelection: "proj-1",
        environmentSelection: undefined,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("No environments were returned");
  });

  it("switches to another project when the first lacks a repository (multi-project)", async () => {
    fetchOrganization.mockResolvedValue({ id: "org-1", tenantId: "tenant-1" });
    fetchProjects.mockResolvedValue([
      { id: "proj-1", name: "Project One" },
      { id: "proj-2", name: "Project Two" },
    ]);
    // proj-1: no repo, no environments; proj-2: has a CM environment.
    fetchProject.mockResolvedValue({ id: "proj-1" }); // no repo fields
    fetchProjectEnvironments
      .mockResolvedValueOnce([]) // proj-1
      .mockResolvedValueOnce([
        { id: "env-cm", name: "CM", environmentType: "cm", tenantId: "tenant-1" },
      ]); // proj-2
    resolveHostFromEnvironment.mockReturnValue("https://two.host");
    promptConfirm.mockResolvedValueOnce(true); // select a different project? yes
    promptText.mockResolvedValueOnce("proj-2"); // pick proj-2

    const updated = {};
    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "proj-1",
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.host).toBe("https://two.host");
    expect(updated).toMatchObject({ projectId: "proj-2", environmentId: "env-cm" });
  });

  it("surfaces the environment-scoped hint when the lookup error mentions env-scoped credentials", async () => {
    fetchOrganization.mockRejectedValue(new Error("This token is environment-scoped"));
    fetchEnvironment.mockResolvedValue({
      id: "env-scoped",
      projectId: "proj-x",
      tenantId: "tenant-x",
      environmentType: "cm",
    });
    resolveHostFromEnvironment.mockReturnValue("https://scoped.host");
    const warn = vi.fn();
    promptText.mockResolvedValue("env-scoped");

    await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated: {},
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: undefined,
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn },
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Environment-scoped credentials require an environment ID")
    );
  });

  it("falls back to options.environment for the environment id when lookup fails", async () => {
    fetchOrganization.mockRejectedValue(new Error("boom"));
    fetchEnvironment.mockResolvedValue({
      id: "opt-env",
      projectId: "proj-o",
      tenantId: "tenant-o",
      environmentType: "cm",
    });
    resolveHostFromEnvironment.mockReturnValue("https://opt.host");

    const updated = {};
    await resolveDeployLookup({
      options: { environment: "opt-env" },
      runWizard: true,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: undefined,
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    // The environment id came from options, so no prompt was needed.
    expect(promptText).not.toHaveBeenCalled();
    expect(fetchEnvironment).toHaveBeenCalledWith({ accessToken: "token" }, "opt-env");
    expect(updated).toMatchObject({ environmentId: "opt-env", projectId: "proj-o" });
  });

  it("keeps a caller-supplied host through the failure-fallback path", async () => {
    fetchOrganization.mockRejectedValue(new Error("boom"));
    fetchEnvironment.mockResolvedValue({ id: "env-1", environmentType: "xp" });
    promptText.mockResolvedValue("env-1");

    const result = await resolveDeployLookup({
      options: {},
      runWizard: true,
      deployToken: "token",
      updated: {},
      existing: {},
      baseEnv: {},
      host: "https://kept.host",
      projectSelection: undefined,
      environmentSelection: undefined,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.host).toBe("https://kept.host");
    expect(resolveHostFromEnvironment).not.toHaveBeenCalled();
  });

  it("falls back from the org id to options.organizationId when the org response omits it", async () => {
    fetchOrganization.mockResolvedValue({ tenantId: "tenant-1" }); // no id / organizationId
    fetchProjects.mockResolvedValue([{ id: "proj-1", name: "Project One" }]);
    fetchProjectEnvironments.mockResolvedValue([
      { id: "env-cm", environmentType: "cm", tenantId: "tenant-1" },
    ]);
    fetchProject.mockResolvedValue({ id: "proj-1", repositoryId: "repo-1" });
    resolveHostFromEnvironment.mockReturnValue("https://h");

    const updated = {};
    await resolveDeployLookup({
      options: { organizationId: "opt-org" },
      runWizard: false,
      deployToken: "token",
      updated,
      existing: {},
      baseEnv: {},
      host: undefined,
      projectSelection: "proj-1",
      environmentSelection: "env-cm",
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(updated.organizationId).toBe("opt-org");
  });
});
