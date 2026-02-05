import { beforeAll, expect } from "vitest";
import {
  createOrganizationDemoSolution,
  fetchOrganization,
  fetchOrganizationHealth,
  fetchOrganizationLicense,
} from "../../src/deploy/api/organizations";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "./helpers";

const orgEnv = "DEPLOY_ORG_ID";
const baseUrlEnv = "DEPLOY_BASE_URL";

const { describe, it } = describeIfDeployAuth();

describe("deploy organizations integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  const orgId = getEnv(orgEnv);

  it("fetches organization", async () => {
    const result = await fetchOrganization({ accessToken, baseUrl });
    expect(result).toBeTruthy();
  });

  if (orgId) {
    it("fetches organization health", async () => {
      const result = await fetchOrganizationHealth({ accessToken, baseUrl }, orgId);
      expect(result).toBeTruthy();
    });

    it("fetches organization license", async () => {
      const result = await fetchOrganizationLicense({ accessToken, baseUrl }, orgId);
      expect(result).toBeTruthy();
    });
  }

  const enableWrites = getEnv("DEPLOY_ENABLE_WRITES") === "1";
  if (enableWrites) {
    it("launches demo solution", async () => {
      const result = await createOrganizationDemoSolution({ accessToken, baseUrl });
      expect(result).toBeTruthy();
    });
  }
});
