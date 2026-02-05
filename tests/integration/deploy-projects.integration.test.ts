import { beforeAll, expect } from "vitest";
import {
  createProject,
  deleteProject,
  fetchProject,
  fetchProjectEnvironments,
  fetchProjects,
  fetchProjectsLimitation,
  linkProjectRepository,
  unlinkProjectRepository,
  updateProject,
  validateProjectName,
} from "../../src/deploy/api/projects";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "./helpers";

const baseUrlEnv = "DEPLOY_BASE_URL";
const projectEnv = "DEPLOY_PROJECT_ID";

const { describe, it } = describeIfDeployAuth();

describe("deploy projects integration", () => {
  let accessToken = "";
  beforeAll(async () => {
    accessToken = await resolveDeployToken();
  });
  const baseUrl = getEnv(baseUrlEnv);
  const projectId = getEnv(projectEnv);

  it("lists projects", async () => {
    const result = await fetchProjects({ accessToken, baseUrl });
    expect(Array.isArray(result)).toBe(true);
  });

  it("fetches project limitations", async () => {
    const result = await fetchProjectsLimitation({ accessToken, baseUrl });
    expect(result).toBeTruthy();
  });

  if (projectId) {
    it("gets a project by id", async () => {
      const result = await fetchProject({ accessToken, baseUrl }, projectId);
      expect(result).toBeTruthy();
    });

    it("lists project environments", async () => {
      const result = await fetchProjectEnvironments({ accessToken, baseUrl }, projectId);
      expect(Array.isArray(result)).toBe(true);
    });
  }

  it("validates a random project name", async () => {
    const name = `scai-test-${Date.now()}`;
    const result = await validateProjectName({ accessToken, baseUrl }, name);
    expect(result).toBeTruthy();
  });

  const enableWrites = getEnv("DEPLOY_ENABLE_WRITES") === "1";
  if (enableWrites) {
    it("creates and deletes a project", async () => {
      const name = `scai-it-${Date.now()}`;
      const created = await createProject({ accessToken, baseUrl }, { name });
      expect(created).toBeTruthy();
      const createdId = (created as { id?: string }).id;
      if (!createdId) {
        throw new Error("Created project did not return an id.");
      }
      await deleteProject({ accessToken, baseUrl }, createdId);
    });

    const repoId = getEnv("DEPLOY_REPOSITORY_ID");
    const integrationId = getEnv("DEPLOY_INTEGRATION_ID");
    if (projectId && repoId && integrationId) {
      it("links and unlinks a repository", async () => {
        await linkProjectRepository({ accessToken, baseUrl }, projectId, {
          repositoryId: repoId,
          integrationId,
        });
        await unlinkProjectRepository({ accessToken, baseUrl }, projectId);
      });
    }

    if (projectId) {
      it("updates a project name", async () => {
        const name = `scai-it-${Date.now()}`;
        await updateProject({ accessToken, baseUrl }, projectId, { name });
      });
    }
  }
});
