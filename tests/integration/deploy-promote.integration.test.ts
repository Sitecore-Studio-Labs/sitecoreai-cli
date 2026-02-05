import { beforeAll, expect } from "vitest";
import { promoteEnvironmentDeployment } from "../../src/deploy/api/environments";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "./helpers";

const baseUrlEnv = "DEPLOY_BASE_URL";
const environmentEnv = "DEPLOY_ENVIRONMENT_ID";
const sourceEnv = "DEPLOY_PROMOTE_SOURCE_DEPLOYMENT_ID";

const { describe, it } = describeIfDeployAuth();

describe("deploy promote integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  const environmentId = getEnv(environmentEnv);
  const sourceId = getEnv(sourceEnv);
  const enableWrites = getEnv("DEPLOY_ENABLE_WRITES") === "1";

  if (!enableWrites) {
    it.skip("promote requires DEPLOY_ENABLE_WRITES=1", () => {});
    return;
  }
  if (!environmentId || !sourceId) {
    it.skip("missing promote env vars", () => {});
    return;
  }

  it("promotes deployment to environment", async () => {
    const result = await promoteEnvironmentDeployment(
      { accessToken, baseUrl },
      environmentId,
      sourceId
    );
    expect(result).toBeTruthy();
  });
});
