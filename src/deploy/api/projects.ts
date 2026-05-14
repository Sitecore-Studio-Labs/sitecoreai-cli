import {
  DeployApiClientOptions,
  DeployEnvironment,
  DeployProject,
  DeployQueryValueList,
  deployRequest,
} from "./common";

export const fetchProjects = async (
  options: DeployApiClientOptions,
  query?: Record<string, DeployQueryValueList | undefined>
): Promise<DeployProject[]> =>
  // The Deploy API paginates this endpoint (default page size 10). Most
  // callers want every project, so the higher-level `fetchAllProjects`
  // is the right entry point; `fetchProjects` itself stays the one-page
  // primitive that `fetchAllProjects` builds on.
  deployRequest<DeployProject[]>(options, "/api/projects/v2", query);

export type FetchAllProjectsResult = {
  totalCount?: number;
  pageSize: number;
  items: DeployProject[];
};

/**
 * Walk every page of `/api/projects/v2`. Mirrors `fetchAllEnvironments`
 * — same backstop, same break conditions, same default page size.
 */
export const fetchAllProjects = async (
  options: DeployApiClientOptions,
  pageSize: number = 50
): Promise<FetchAllProjectsResult> => {
  const items: DeployProject[] = [];
  let totalCount: number | undefined;
  const maxPages = 100;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = (await fetchProjects(options, {
      PageNumber: pageNumber,
      PageSize: pageSize,
    })) as DeployProject[] | { data?: DeployProject[]; totalCount?: number };
    const data = Array.isArray(page)
      ? page
      : Array.isArray(page?.data)
        ? page.data
        : [];
    if (!Array.isArray(page) && typeof page?.totalCount === "number") {
      totalCount = page.totalCount;
    }
    items.push(...data);
    if (data.length < pageSize) {
      break;
    }
    if (totalCount !== undefined && items.length >= totalCount) {
      break;
    }
  }
  return { totalCount, pageSize, items };
};

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
  projectId: string,
  query?: Record<string, DeployQueryValueList | undefined>
): Promise<DeployEnvironment[]> =>
  // First-page primitive. Use `fetchAllProjectEnvironments` for any
  // lookup that needs to find a specific environment by name/id — the
  // Deploy API paginates this endpoint at 10 by default and a project
  // with >10 environments will otherwise produce false "not found"s.
  deployRequest<DeployEnvironment[]>(
    options,
    `/api/projects/v2/${projectId}/environments`,
    query
  );

export type FetchAllProjectEnvironmentsResult = {
  totalCount?: number;
  pageSize: number;
  items: DeployEnvironment[];
};

export const fetchAllProjectEnvironments = async (
  options: DeployApiClientOptions,
  projectId: string,
  pageSize: number = 50
): Promise<FetchAllProjectEnvironmentsResult> => {
  const items: DeployEnvironment[] = [];
  let totalCount: number | undefined;
  const maxPages = 100;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = (await fetchProjectEnvironments(options, projectId, {
      PageNumber: pageNumber,
      PageSize: pageSize,
    })) as DeployEnvironment[] | { data?: DeployEnvironment[]; totalCount?: number };
    const data = Array.isArray(page)
      ? page
      : Array.isArray(page?.data)
        ? page.data
        : [];
    if (!Array.isArray(page) && typeof page?.totalCount === "number") {
      totalCount = page.totalCount;
    }
    items.push(...data);
    if (data.length < pageSize) {
      break;
    }
    if (totalCount !== undefined && items.length >= totalCount) {
      break;
    }
  }
  return { totalCount, pageSize, items };
};

export const createProjectEnvironment = async (
  options: DeployApiClientOptions,
  projectId: string,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/projects/v2/${projectId}/environments`, undefined, {
    method: "POST",
    body,
  });
