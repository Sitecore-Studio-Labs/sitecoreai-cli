import { beforeAll, expect } from "vitest";
import {
  createEnvironmentDeployment,
  deleteEnvironment,
  fetchEnvironment,
  fetchEnvironmentDeployments,
  fetchEnvironmentEditingSecret,
  fetchEnvironmentEdgeToken,
  fetchEnvironmentRestartStatus,
  fetchEnvironmentVariables,
  fetchEnvironments,
  fetchEnvironmentsLimitation,
  linkEnvironmentRepository,
  regenerateEnvironmentContext,
  restartEnvironment,
  unlinkEnvironmentRepository,
} from "../../src/deploy/api/environments";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "./helpers";

const baseUrlEnv = "DEPLOY_BASE_URL";
const environmentEnv = "DEPLOY_ENVIRONMENT_ID";

const { describe, it } = describeIfDeployAuth();

describe("deploy environments integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  const environmentId = getEnv(environmentEnv);

  it("lists environments", async () => {
    const result = await fetchEnvironments({ accessToken, baseUrl });
    expect(result).toBeTruthy();
  });

  it("fetches environment limitations", async () => {
    const result = await fetchEnvironmentsLimitation({ accessToken, baseUrl });
    expect(result).toBeTruthy();
  });

  if (environmentId) {
    it("gets environment by id", async () => {
      const result = await fetchEnvironment({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });

    it("lists environment deployments", async () => {
      const result = await fetchEnvironmentDeployments({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });

    it("lists environment variables", async () => {
      const result = await fetchEnvironmentVariables({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });

    it("fetches edge token", async () => {
      const result = await fetchEnvironmentEdgeToken({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });

    it("fetches editing secret", async () => {
      const result = await fetchEnvironmentEditingSecret({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });

    it("gets restart status", async () => {
      const result = await fetchEnvironmentRestartStatus({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });
  }

  const enableWrites = getEnv("DEPLOY_ENABLE_WRITES") === "1";
  if (enableWrites && environmentId) {
    it("restarts an environment", async () => {
      const result = await restartEnvironment({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });

    it("regenerates environment context", async () => {
      const result = await regenerateEnvironmentContext({ accessToken, baseUrl }, environmentId);
      expect(result).toBeTruthy();
    });

    it("deploys environment linked source", async () => {
      const result = await createEnvironmentDeployment(
        { accessToken, baseUrl },
        environmentId,
        true
      );
      expect(result).toBeTruthy();
    });
  }

  const repoId = getEnv("DEPLOY_REPOSITORY_ID");
  const integrationId = getEnv("DEPLOY_INTEGRATION_ID");
  const repoName = getEnv("DEPLOY_REPOSITORY_NAME");
  const repoPath = getEnv("DEPLOY_REPOSITORY_RELATIVE_PATH");
  const repoBranch = getEnv("DEPLOY_REPOSITORY_BRANCH");
  if (
    enableWrites &&
    environmentId &&
    repoId &&
    integrationId &&
    repoName &&
    repoPath &&
    repoBranch
  ) {
    it("links and unlinks an environment repository", async () => {
      await linkEnvironmentRepository({ accessToken, baseUrl }, environmentId, {
        repository: repoName,
        repositoryId: repoId,
        integrationId,
        repositoryRelativePath: repoPath,
        repositoryBranch: repoBranch,
      });
      await unlinkEnvironmentRepository({ accessToken, baseUrl }, environmentId);
    });
  }

  if (enableWrites && environmentId) {
    it("deletes environment when requested", async () => {
      const shouldDelete = getEnv("DEPLOY_DELETE_ENVIRONMENT") === "1";
      if (!shouldDelete) {
        return;
      }
      await deleteEnvironment({ accessToken, baseUrl }, environmentId);
    });
  }
});
