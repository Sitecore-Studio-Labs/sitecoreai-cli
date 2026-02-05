import { beforeAll, expect } from "vitest";
import { createProjectEnvironment } from "../../src/deploy/api/projects";
import { deleteEnvironment, fetchEnvironment } from "../../src/deploy/api/environments";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "./helpers";

const baseUrlEnv = "DEPLOY_BASE_URL";
const cmEnvEnv = "DEPLOY_EDITING_HOST_CM_ENVIRONMENT_ID";
const nameEnv = "DEPLOY_EDITING_HOST_NAME";

const { describe, it } = describeIfDeployAuth();

const resolveTenantType = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "prod" || normalized === "production") {
      return 1;
    }
  }
  return 0;
};

describe("deploy editing host integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  const cmEnvironmentId = getEnv(cmEnvEnv);
  const name = getEnv(nameEnv);
  const enableWrites = getEnv("DEPLOY_ENABLE_WRITES") === "1";

  if (!enableWrites) {
    it.skip("editing host create/delete requires DEPLOY_ENABLE_WRITES=1", () => {});
    return;
  }
  if (!cmEnvironmentId || !name) {
    it.skip("missing editing host env vars", () => {});
    return;
  }

  it("creates and deletes editing host environment", async () => {
    const cmEnv = (await fetchEnvironment({ accessToken, baseUrl }, cmEnvironmentId)) as Record<
      string,
      unknown
    >;

    const projectId = typeof cmEnv.projectId === "string" ? cmEnv.projectId : undefined;
    expect(projectId).toBeTruthy();

    const tenantType = resolveTenantType(cmEnv.tenantType);
    const createBody = {
      name,
      tenantType,
      type: "eh",
      editingHostEnvironmentDetails: {
        cmEnvironmentId,
      },
    };

    const created = (await createProjectEnvironment(
      { accessToken, baseUrl },
      projectId as string,
      createBody
    )) as Record<string, unknown>;

    const createdId =
      typeof created.id === "string"
        ? created.id
        : typeof created.environmentId === "string"
          ? created.environmentId
          : undefined;

    expect(createdId).toBeTruthy();

    await deleteEnvironment({ accessToken, baseUrl }, createdId as string);
  });
});
