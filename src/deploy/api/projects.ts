import { DeployApiClientOptions, DeployEnvironment, DeployProject, deployRequest } from "./common";

export const fetchProjects = async (options: DeployApiClientOptions): Promise<DeployProject[]> =>
  deployRequest<DeployProject[]>(options, "/api/projects/v2");

export const fetchProjectsLimitation = async (options: DeployApiClientOptions): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/projects/v1/limitation");

export const validateProjectName = async (
  options: DeployApiClientOptions,
  name: string
): Promise<unknown> => deployRequest<unknown>(options, "/api/projects/v2/validatename", { name });

export const fetchProject = async (
  options: DeployApiClientOptions,
  projectId: string
): Promise<DeployProject> => deployRequest<DeployProject>(options, `/api/projects/v2/${projectId}`);

export const createProject = async (
  options: DeployApiClientOptions,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/projects/v1", undefined, {
    method: "POST",
    body,
  });

export const deleteProject = async (
  options: DeployApiClientOptions,
  projectId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/projects/v1/${projectId}`, undefined, {
    method: "DELETE",
  });

export const updateProject = async (
  options: DeployApiClientOptions,
  projectId: string,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/projects/v1/${projectId}`, undefined, {
    method: "PUT",
    body,
  });

export const linkProjectRepository = async (
  options: DeployApiClientOptions,
  projectId: string,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/projects/v1/${projectId}/repository`, undefined, {
    method: "PUT",
    body,
  });

export const unlinkProjectRepository = async (
  options: DeployApiClientOptions,
  projectId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/projects/v1/${projectId}/repository`, undefined, {
    method: "DELETE",
  });

export const fetchProjectEnvironments = async (
  options: DeployApiClientOptions,
  projectId: string
): Promise<DeployEnvironment[]> =>
  deployRequest<DeployEnvironment[]>(options, `/api/projects/v2/${projectId}/environments`);

export const createProjectEnvironment = async (
  options: DeployApiClientOptions,
  projectId: string,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/projects/v2/${projectId}/environments`, undefined, {
    method: "POST",
    body,
  });
