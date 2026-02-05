import { beforeAll, expect } from "vitest";
import {
  fetchSourceControlAccessToken,
  fetchSourceControlIntegrations,
  fetchSourceControlIntegrationState,
  fetchSourceControlProviders,
  fetchSourceControlRepository,
  fetchSourceControlRepositoryBranches,
  fetchSourceControlTemplates,
  validateSourceControlIntegration,
  validateSourceControlRepository,
} from "../../src/deploy/api/source-control";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "./helpers";

const baseUrlEnv = "DEPLOY_BASE_URL";
const orgEnv = "DEPLOY_ORG_ID";

const { describe, it } = describeIfDeployAuth();

describe("deploy source-control integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  const orgId = getEnv(orgEnv);

  it("lists integrations", async () => {
    const result = await fetchSourceControlIntegrations({ accessToken, baseUrl });
    expect(result).toBeTruthy();
  });

  if (orgId) {
    it("gets integration state", async () => {
      const result = await fetchSourceControlIntegrationState({ accessToken, baseUrl }, orgId);
      expect(result).toBeTruthy();
    });

    it("lists providers", async () => {
      const result = await fetchSourceControlProviders({ accessToken, baseUrl }, orgId);
      expect(result).toBeTruthy();
    });

    it("lists templates", async () => {
      const result = await fetchSourceControlTemplates(
        { accessToken, baseUrl },
        { provider: "github" },
        orgId
      );
      expect(result).toBeTruthy();
    });
  }

  const integrationId = getEnv("DEPLOY_INTEGRATION_ID");
  if (integrationId && orgId) {
    it("fetches access token", async () => {
      const result = await fetchSourceControlAccessToken(
        { accessToken, baseUrl },
        integrationId,
        orgId
      );
      expect(result).toBeTruthy();
    });
  }

  const repoId = getEnv("DEPLOY_REPOSITORY_ID");
  if (integrationId && repoId && orgId) {
    it("lists repositories", async () => {
      const result = await fetchSourceControlRepository(
        { accessToken, baseUrl },
        { IntegrationId: integrationId, RepositoryId: repoId },
        orgId
      );
      expect(result).toBeTruthy();
    });
  }

  const repoName = getEnv("DEPLOY_REPOSITORY_NAME");
  if (integrationId && repoName && orgId) {
    it("lists repository branches", async () => {
      const result = await fetchSourceControlRepositoryBranches(
        { accessToken, baseUrl },
        repoName,
        { IntegrationId: integrationId },
        orgId
      );
      expect(result).toBeTruthy();
    });
  }

  const enableWrites = getEnv("DEPLOY_ENABLE_WRITES") === "1";
  if (enableWrites && integrationId && orgId) {
    it("validates integration", async () => {
      const result = await validateSourceControlIntegration(
        { accessToken, baseUrl },
        { integrationId },
        orgId
      );
      expect(result).toBeTruthy();
    });
  }

  if (enableWrites && integrationId && repoName && orgId) {
    it("validates repository", async () => {
      const result = await validateSourceControlRepository(
        { accessToken, baseUrl },
        { integrationId, repositoryName: repoName },
        orgId
      );
      expect(result).toBeTruthy();
    });
  }
});
