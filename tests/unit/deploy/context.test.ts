/**
 * Branch + function coverage for `src/deploy/context.ts` — the
 * presentation-free Deploy API context + lookup module shared by the
 * CLI runners and MCP tools. Pure helpers (`getEnvironmentType`,
 * `filterEnvironmentsByType`, `extractDeployEnvironmentList`,
 * `resolveEnvironmentType`, `resolveTenantTypeValue`,
 * `resolveProjectIdValue`) are exercised against fixtures; the
 * lookup helpers (`getDeployContext`, `resolveDeployOrganizationId`,
 * `resolveDeployProjectId`, `resolveDeployEnvironmentId`) run against
 * mocked keychain / policy / deploy-API modules.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeployEnvironment } from "../../../src/deploy/api/common/types";

const apiMocks = vi.hoisted(() => ({
  fetchOrganization: vi.fn(),
  fetchAllProjects: vi.fn(),
  fetchAllProjectEnvironments: vi.fn(),
  fetchAllEnvironments: vi.fn(),
}));
vi.mock("../../../src/deploy/api/organizations", () => ({
  fetchOrganization: apiMocks.fetchOrganization,
}));
vi.mock("../../../src/deploy/api/projects", () => ({
  fetchAllProjects: apiMocks.fetchAllProjects,
  fetchAllProjectEnvironments: apiMocks.fetchAllProjectEnvironments,
}));
vi.mock("../../../src/deploy/api/environments", () => ({
  fetchAllEnvironments: apiMocks.fetchAllEnvironments,
}));

const keychainMocks = vi.hoisted(() => ({ getDeployToken: vi.fn() }));
vi.mock("../../../src/shared/keychain", () => keychainMocks);

const policyMocks = vi.hoisted(() => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../src/policy/environment", () => policyMocks);

import {
  extractDeployEnvironmentList,
  filterEnvironmentsByType,
  getDeployContext,
  getEnvironmentType,
  resolveDeployEnvironmentId,
  resolveDeployOrganizationId,
  resolveDeployProjectId,
  resolveEnvironmentType,
  resolveProjectIdValue,
  resolveTenantTypeValue,
} from "../../../src/deploy/context";

const env = (overrides: Record<string, unknown>): DeployEnvironment =>
  overrides as unknown as DeployEnvironment;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getEnvironmentType", () => {
  it("returns the first string-typed top-level candidate (projectType wins)", () => {
    expect(getEnvironmentType(env({ projectType: "cm", type: "eh" }))).toBe("cm");
  });

  it("falls through to projectTypeName / environmentType / type in order", () => {
    expect(getEnvironmentType(env({ projectTypeName: "eh" }))).toBe("eh");
    expect(getEnvironmentType(env({ environmentType: "combined" }))).toBe("combined");
    expect(getEnvironmentType(env({ type: "cm" }))).toBe("cm");
  });

  it("reads the type off a nested project object when no top-level type exists", () => {
    expect(getEnvironmentType(env({ project: { projectType: "cm" } }))).toBe("cm");
    expect(getEnvironmentType(env({ project: { type: "eh" } }))).toBe("eh");
  });

  it("ignores a non-string top-level candidate and falls to the nested project", () => {
    expect(getEnvironmentType(env({ projectType: 7, project: { type: "cm" } }))).toBe("cm");
  });

  it("returns undefined when neither top-level nor nested types are present", () => {
    expect(getEnvironmentType(env({ name: "x" }))).toBeUndefined();
  });

  it("returns undefined when project is present but not an object", () => {
    expect(getEnvironmentType(env({ project: "not-an-object" }))).toBeUndefined();
  });
});

describe("filterEnvironmentsByType", () => {
  const cm = env({ id: "e-cm", type: "cm" });
  const eh = env({ id: "e-eh", type: "eh" });
  const untyped = env({ id: "e-untyped" });

  it("returns the input unchanged when no type filter is supplied", () => {
    expect(filterEnvironmentsByType([cm, eh])).toEqual([cm, eh]);
  });

  it("keeps only environments whose type contains the requested substring", () => {
    expect(filterEnvironmentsByType([cm, eh], "cm")).toEqual([cm]);
  });

  it("matches case-insensitively", () => {
    expect(filterEnvironmentsByType([cm, eh], "CM")).toEqual([cm]);
  });

  it("returns the original list when no environment carries a type at all", () => {
    expect(filterEnvironmentsByType([untyped], "cm")).toEqual([untyped]);
  });

  it("returns an empty list when types exist but none match", () => {
    expect(filterEnvironmentsByType([cm, eh], "xp")).toEqual([]);
  });
});

describe("extractDeployEnvironmentList", () => {
  it("returns the array unchanged when given a bare array", () => {
    const arr = [env({ id: "a" })];
    expect(extractDeployEnvironmentList(arr)).toBe(arr);
  });

  it("unwraps an `items` array", () => {
    expect(extractDeployEnvironmentList({ items: [env({ id: "i" })] })).toEqual([env({ id: "i" })]);
  });

  it("unwraps a `data` array", () => {
    expect(extractDeployEnvironmentList({ data: [env({ id: "d" })] })).toEqual([env({ id: "d" })]);
  });

  it("unwraps an `environments` array", () => {
    expect(extractDeployEnvironmentList({ environments: [env({ id: "e" })] })).toEqual([
      env({ id: "e" }),
    ]);
  });

  it("returns an empty array for an object with no recognised array key", () => {
    expect(extractDeployEnvironmentList({ count: 3 })).toEqual([]);
  });

  it("returns an empty array for null / primitive input", () => {
    expect(extractDeployEnvironmentList(null)).toEqual([]);
    expect(extractDeployEnvironmentList("nope")).toEqual([]);
    expect(extractDeployEnvironmentList(42)).toEqual([]);
  });
});

describe("resolveEnvironmentType", () => {
  it("returns the lowercased `type` field", () => {
    expect(resolveEnvironmentType({ type: "CM" })).toBe("cm");
  });

  it("falls through to environmentType then envType", () => {
    expect(resolveEnvironmentType({ environmentType: "EH" })).toBe("eh");
    expect(resolveEnvironmentType({ envType: "Combined" })).toBe("combined");
  });

  it("returns undefined for a non-object", () => {
    expect(resolveEnvironmentType(null)).toBeUndefined();
    expect(resolveEnvironmentType("cm")).toBeUndefined();
  });

  it("returns undefined when the type field is present but not a string", () => {
    expect(resolveEnvironmentType({ type: 5 })).toBeUndefined();
  });
});

describe("resolveTenantTypeValue", () => {
  it("returns a numeric value verbatim", () => {
    expect(resolveTenantTypeValue(3)).toBe(3);
  });

  it("maps prod / production to 1", () => {
    expect(resolveTenantTypeValue("prod")).toBe(1);
    expect(resolveTenantTypeValue(" Production ")).toBe(1);
  });

  it("maps nonprod variants to 0", () => {
    expect(resolveTenantTypeValue("nonprod")).toBe(0);
    expect(resolveTenantTypeValue("non-production")).toBe(0);
    expect(resolveTenantTypeValue("nonproduction")).toBe(0);
  });

  it("returns undefined for an unrecognised string", () => {
    expect(resolveTenantTypeValue("staging")).toBeUndefined();
  });

  it("returns undefined for a non-string / non-number value", () => {
    expect(resolveTenantTypeValue(undefined)).toBeUndefined();
    expect(resolveTenantTypeValue({})).toBeUndefined();
  });
});

describe("resolveProjectIdValue", () => {
  it("returns a non-empty string verbatim", () => {
    expect(resolveProjectIdValue("proj-1")).toBe("proj-1");
  });

  it("returns undefined for an empty / whitespace string", () => {
    expect(resolveProjectIdValue("")).toBeUndefined();
    expect(resolveProjectIdValue("   ")).toBeUndefined();
  });

  it("returns undefined for a non-string value", () => {
    expect(resolveProjectIdValue(123)).toBeUndefined();
    expect(resolveProjectIdValue(null)).toBeUndefined();
  });
});

describe("getDeployContext", () => {
  it("resolves a context from the keychain token + env profile ids", async () => {
    policyMocks.resolveEnvironment.mockReturnValue({
      envName: "sandbox",
      environment: {
        organizationId: "org-1",
        projectId: "proj-1",
        environmentId: "env-1",
        environmentType: "cm",
        editingHostEnvironmentIds: ["eh-1"],
      },
    });
    keychainMocks.getDeployToken.mockResolvedValue("kc-token");

    const ctx = await getDeployContext({ whatIf: true });

    expect(ctx).toEqual({
      token: "kc-token",
      baseUrl: undefined,
      envName: "sandbox",
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-1",
      environmentType: "cm",
      editingHostEnvironmentIds: ["eh-1"],
      whatIf: true,
    });
  });

  it("falls back to the env profile's deployToken when the keychain has none", async () => {
    policyMocks.resolveEnvironment.mockReturnValue({
      envName: "sandbox",
      environment: { deployToken: "profile-token" },
    });
    keychainMocks.getDeployToken.mockResolvedValue(undefined);

    const ctx = await getDeployContext({});
    expect(ctx.token).toBe("profile-token");
  });

  it("throws AUTH_REQUIRED when neither the keychain nor the profile has a token", async () => {
    policyMocks.resolveEnvironment.mockReturnValue({
      envName: "sandbox",
      environment: {},
    });
    keychainMocks.getDeployToken.mockResolvedValue(undefined);

    await expect(getDeployContext({})).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("resolveDeployOrganizationId", () => {
  it("returns the context organizationId without an API call when present", async () => {
    const result = await resolveDeployOrganizationId({ token: "t", organizationId: "org-ctx" });
    expect(result).toBe("org-ctx");
    expect(apiMocks.fetchOrganization).not.toHaveBeenCalled();
  });

  it("fetches the organization and returns its id when the context has none", async () => {
    apiMocks.fetchOrganization.mockResolvedValue({ id: "org-fetched" });
    expect(await resolveDeployOrganizationId({ token: "t" })).toBe("org-fetched");
  });

  it("falls back to organizationId on the fetched org when `id` is absent", async () => {
    apiMocks.fetchOrganization.mockResolvedValue({ organizationId: "org-alt" });
    expect(await resolveDeployOrganizationId({ token: "t" })).toBe("org-alt");
  });

  it("returns undefined when the organization fetch throws", async () => {
    apiMocks.fetchOrganization.mockRejectedValue(new Error("boom"));
    expect(await resolveDeployOrganizationId({ token: "t" })).toBeUndefined();
  });
});

describe("resolveDeployProjectId", () => {
  it("returns undefined when no project selection is supplied", async () => {
    expect(await resolveDeployProjectId({ token: "t" }, {})).toBeUndefined();
    expect(apiMocks.fetchAllProjects).not.toHaveBeenCalled();
  });

  it("returns the selection verbatim in --what-if mode without a lookup", async () => {
    const result = await resolveDeployProjectId(
      { token: "t", whatIf: true },
      { project: "My Project" }
    );
    expect(result).toBe("My Project");
    expect(apiMocks.fetchAllProjects).not.toHaveBeenCalled();
  });

  it("walks all project pages and matches a project by name", async () => {
    apiMocks.fetchAllProjects.mockResolvedValue({
      items: [{ id: "p-1", name: "My Project" }],
    });
    expect(await resolveDeployProjectId({ token: "t" }, { project: "My Project" })).toBe("p-1");
    expect(apiMocks.fetchAllProjects).toHaveBeenCalled();
  });

  it("falls back to projectId when the matched project lacks `id`", async () => {
    apiMocks.fetchAllProjects.mockResolvedValue({
      items: [{ projectId: "p-alt", name: "My Project" }],
    });
    expect(await resolveDeployProjectId({ token: "t" }, { project: "My Project" })).toBe("p-alt");
  });
});

describe("resolveDeployEnvironmentId", () => {
  it("returns --id immediately, skipping every lookup", async () => {
    const result = await resolveDeployEnvironmentId({ token: "t" }, { id: "env-explicit" });
    expect(result).toBe("env-explicit");
    expect(apiMocks.fetchAllEnvironments).not.toHaveBeenCalled();
    expect(apiMocks.fetchAllProjectEnvironments).not.toHaveBeenCalled();
  });

  it("returns the --name selection verbatim in --what-if mode", async () => {
    const result = await resolveDeployEnvironmentId(
      { token: "t", whatIf: true },
      { name: "Env Name" }
    );
    expect(result).toBe("Env Name");
    expect(apiMocks.fetchAllEnvironments).not.toHaveBeenCalled();
  });

  it("returns context.environmentId in --what-if mode when no name is given", async () => {
    const result = await resolveDeployEnvironmentId(
      { token: "t", whatIf: true, environmentId: "ctx-env" },
      {}
    );
    expect(result).toBe("ctx-env");
  });

  it("throws INPUT_INVALID in --what-if mode with no name and no context env id", async () => {
    await expect(
      resolveDeployEnvironmentId({ token: "t", whatIf: true }, {})
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("returns context.environmentId when no name/id is supplied (non-what-if)", async () => {
    const result = await resolveDeployEnvironmentId({ token: "t", environmentId: "ctx-env" }, {});
    expect(result).toBe("ctx-env");
  });

  it("throws an input error when no name/id and no context env id are available", async () => {
    await expect(
      resolveDeployEnvironmentId({ token: "t", envName: "sandbox" }, {})
    ).rejects.toThrow(/Environment name or ID is required/);
  });

  it("resolves a name within a project by walking the project's environment pages", async () => {
    apiMocks.fetchAllProjects.mockResolvedValue({
      items: [{ id: "p-1", name: "My Project" }],
    });
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      items: [{ id: "env-target", name: "Target" }],
    });
    const result = await resolveDeployEnvironmentId(
      { token: "t" },
      { name: "Target", project: "My Project" }
    );
    expect(result).toBe("env-target");
    expect(apiMocks.fetchAllProjectEnvironments).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "t" }),
      "p-1"
    );
  });

  it("falls back to environmentId on the matched project env when `id` is absent", async () => {
    apiMocks.fetchAllProjects.mockResolvedValue({
      items: [{ id: "p-1", name: "My Project" }],
    });
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      items: [{ environmentId: "env-alt", name: "Target" }],
    });
    const result = await resolveDeployEnvironmentId(
      { token: "t" },
      { name: "Target", project: "My Project" }
    );
    expect(result).toBe("env-alt");
  });

  it("throws when the matched project env carries no id at all", async () => {
    apiMocks.fetchAllProjects.mockResolvedValue({
      items: [{ id: "p-1", name: "My Project" }],
    });
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      items: [{ name: "Target" }],
    });
    await expect(
      resolveDeployEnvironmentId({ token: "t" }, { name: "Target", project: "My Project" })
    ).rejects.toThrow(/Environment ID was not available/);
  });

  it("resolves a name org-wide when no project is supplied", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      items: [{ id: "env-org", name: "Org Env" }],
    });
    const result = await resolveDeployEnvironmentId({ token: "t" }, { name: "Org Env" });
    expect(result).toBe("env-org");
    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalled();
  });

  it("falls back to environmentId on the org-wide matched env when `id` is absent", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      items: [{ environmentId: "env-org-alt", name: "Org Env" }],
    });
    const result = await resolveDeployEnvironmentId({ token: "t" }, { name: "Org Env" });
    expect(result).toBe("env-org-alt");
  });

  it("throws when the org-wide matched env carries no id", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      items: [{ name: "Org Env" }],
    });
    await expect(resolveDeployEnvironmentId({ token: "t" }, { name: "Org Env" })).rejects.toThrow(
      /Environment ID was not available/
    );
  });
});
