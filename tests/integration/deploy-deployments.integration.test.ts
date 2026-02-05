import { beforeAll, expect } from "vitest";
import {
  cancelDeployment,
  deployDeployment,
  fetchDeployment,
  fetchDeploymentV3,
  fetchDeploymentStatus,
  fetchDeployments,
} from "../../src/deploy/api/deployments";
import { fetchDeploymentLogs } from "../../src/deploy/api/deployment-logs";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "./helpers";

const baseUrlEnv = "DEPLOY_BASE_URL";
const deploymentEnv = "DEPLOY_DEPLOYMENT_ID";

const { describe, it } = describeIfDeployAuth();

describe("deploy deployments integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  const deploymentId = getEnv(deploymentEnv);

  it("lists deployments", async () => {
    const result = await fetchDeployments({ accessToken, baseUrl });
    expect(result).toBeTruthy();
  });

  it("fetches deployment status counts", async () => {
    const result = await fetchDeploymentStatus({ accessToken, baseUrl });
    expect(result).toBeTruthy();
  });

  if (deploymentId) {
    it("gets deployment by id", async () => {
      const result = await fetchDeployment({ accessToken, baseUrl }, deploymentId);
      expect(result).toBeTruthy();
    });

    it("gets deployment by id (v3)", async () => {
      const result = await fetchDeploymentV3({ accessToken, baseUrl }, deploymentId);
      expect(result).toBeTruthy();
    });

    it("fetches deployment logs", async () => {
      const result = await fetchDeploymentLogs(deploymentId, accessToken);
      expect(result).toBeTruthy();
    });
  }

  const enableWrites = getEnv("DEPLOY_ENABLE_WRITES") === "1";
  if (enableWrites && deploymentId) {
    it("deploys deployment", async () => {
      const result = await deployDeployment({ accessToken, baseUrl }, deploymentId);
      expect(result).toBeTruthy();
    });

    it("cancels deployment", async () => {
      const result = await cancelDeployment({ accessToken, baseUrl }, deploymentId);
      expect(result).toBeTruthy();
    });
  }
});
