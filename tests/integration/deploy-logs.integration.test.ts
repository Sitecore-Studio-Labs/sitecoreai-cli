import { beforeAll, expect } from "vitest";
import { fetchLogFile, fetchLogList } from "../../src/deploy/api/logs";
import { describeIfDeployAuth, getEnv, resolveDeployToken, resolveEnvironmentId } from "./helpers";

const baseUrlEnv = "DEPLOY_BASE_URL";
const environmentEnv = "DEPLOY_ENVIRONMENT_ID";
const logFileEnv = "DEPLOY_LOG_FILE";
const orgIdEnv = "DEPLOY_ORG_ID";

const { describe, it } = describeIfDeployAuth();

describe("deploy logs integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  let environmentId = getEnv(environmentEnv);
  const logFile = getEnv(logFileEnv);
  const organizationId = getEnv(orgIdEnv);

  beforeAll(async () => {
    if (!environmentId) {
      environmentId = await resolveEnvironmentId(accessToken, baseUrl, getEnv("DEPLOY_PROJECT_ID"));
    }
  });

  if (!environmentId) {
    it.skip("missing DEPLOY_ENVIRONMENT_ID (and auto-resolve failed)", () => {});
    return;
  }

  it("lists log files", async () => {
    const result = await fetchLogList(
      { accessToken, baseUrl },
      environmentId,
      true,
      organizationId
    );
    expect(result).toBeTruthy();
  });

  if (logFile) {
    it("views a log file", async () => {
      const result = await fetchLogFile(
        { accessToken, baseUrl },
        environmentId,
        logFile,
        false,
        organizationId
      );
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
    });
  }
});
