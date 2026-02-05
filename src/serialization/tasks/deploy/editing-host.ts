import {
  fetchEnvironment,
  fetchProjectEnvironments,
  fetchEnvironments,
  createProjectEnvironment,
  deleteEnvironment,
  updateEnvironment,
  createEnvironmentDeployment,
} from "@/deploy/api";
import {
  extractDeployEnvironmentList,
  getDeployContext,
  getEnvironmentType,
  inputError,
  printDeployResultWithContext,
  printDeployWhatIf,
  resolveDeployProjectId,
  resolveEnvironmentType,
  resolveProjectIdValue,
  resolveTenantTypeValue,
  toLogger,
} from "../shared";
import type {
  DeployEditingHostCreateOptions,
  DeployEditingHostDeleteOptions,
  DeployEditingHostDeployOptions,
  DeployEditingHostListOptions,
  DeployEditingHostUpdateOptions,
} from "../types";
import { printDeploymentResult } from "./deployment-result";
import { runDeployDeploymentsWatch } from "./deployments";

export const runDeployEditingHostCreate = async (
  options: DeployEditingHostCreateOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.cmEnvironmentId) {
    throw inputError("CM environment ID is required. Use --cm-environment-id.");
  }
  if (!options.name) {
    throw inputError("Editing host name is required. Use --name.");
  }
  const cmEnvironment = (await fetchEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.cmEnvironmentId
  )) as Record<string, unknown>;
  const projectId = resolveProjectIdValue(cmEnvironment.projectId);
  if (!projectId) {
    throw inputError("Project ID was not available on the CM environment.");
  }
  const tenantType = resolveTenantTypeValue(cmEnvironment.tenantType) ?? 0;

  const body: Record<string, unknown> = {
    name: options.name,
    tenantType,
    type: "eh",
    editingHostEnvironmentDetails: {
      cmEnvironmentId: options.cmEnvironmentId,
    },
  };
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.editing-host.create", {
      method: "POST",
      path: `/api/projects/v2/${projectId}/environments`,
      body,
    });
    return;
  }
  const result = await createProjectEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    projectId,
    body
  );
  printDeployResultWithContext(logger, context, "deploy.editing-host.create", result);
};

export const runDeployEditingHostList = async (
  options: DeployEditingHostListOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  let projectId: string | undefined;

  if (options.project) {
    projectId = await resolveDeployProjectId(context, { project: options.project });
  } else if (context.projectId) {
    projectId = context.projectId;
  } else if (context.environmentId) {
    try {
      const env = await fetchEnvironment(
        { accessToken: context.token, baseUrl: context.baseUrl },
        context.environmentId
      );
      projectId = resolveProjectIdValue(env.projectId);
    } catch {
      projectId = undefined;
    }
  }

  const result = projectId
    ? await fetchProjectEnvironments(
        { accessToken: context.token, baseUrl: context.baseUrl },
        projectId
      )
    : await fetchEnvironments({ accessToken: context.token, baseUrl: context.baseUrl }, {});

  const list = extractDeployEnvironmentList(result);
  const editingHosts = list.filter((environment) => {
    const type = getEnvironmentType(environment);
    return type ? type.toLowerCase().includes("eh") : false;
  });

  printDeployResultWithContext(logger, context, "deploy.editing-host.list", editingHosts);
};

export const runDeployEditingHostDelete = async (
  options: DeployEditingHostDeleteOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Editing host environment ID is required. Use --id.");
  }
  const knownEditingHosts = new Set(context.editingHostEnvironmentIds ?? []);
  const isEditingHostProfile =
    context.environmentType === "eh" && context.environmentId === options.id;
  if (!knownEditingHosts.has(options.id) && !isEditingHostProfile) {
    const env = (await fetchEnvironment(
      { accessToken: context.token, baseUrl: context.baseUrl },
      options.id
    )) as Record<string, unknown>;
    const type = resolveEnvironmentType(env);
    if (type && type !== "eh") {
      throw inputError(`Environment ${options.id} is not an editing host.`);
    }
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.editing-host.delete", {
      method: "DELETE",
      path: `/api/environments/v1/${options.id}`,
      query: options.force ? { force: true } : undefined,
    });
    return;
  }
  const result = await deleteEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id,
    options.force
  );
  printDeployResultWithContext(logger, context, "deploy.editing-host.delete", result);
};

export const runDeployEditingHostUpdate = async (
  options: DeployEditingHostUpdateOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Editing host environment ID is required. Use --id.");
  }
  if (!options.name) {
    throw inputError("Editing host name is required. Use --name.");
  }
  const knownEditingHosts = new Set(context.editingHostEnvironmentIds ?? []);
  const isEditingHostProfile =
    context.environmentType === "eh" && context.environmentId === options.id;
  if (!knownEditingHosts.has(options.id) && !isEditingHostProfile) {
    const env = (await fetchEnvironment(
      { accessToken: context.token, baseUrl: context.baseUrl },
      options.id
    )) as Record<string, unknown>;
    const type = resolveEnvironmentType(env);
    if (type && type !== "eh") {
      throw inputError(`Environment ${options.id} is not an editing host.`);
    }
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.editing-host.update", {
      method: "PUT",
      path: `/api/environments/v1/${options.id}`,
      body: { name: options.name },
    });
    return;
  }
  const result = await updateEnvironment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id,
    { name: options.name }
  );
  printDeployResultWithContext(logger, context, "deploy.editing-host.update", result);
};

export const runDeployEditingHostDeploy = async (
  options: DeployEditingHostDeployOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Editing host environment ID is required. Use --id.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.editing-host.deploy", {
      method: "POST",
      path: `/api/environments/v2/${options.id}/deployments`,
      query: options.redeploy === undefined ? undefined : { redeploy: options.redeploy },
    });
    return;
  }
  const knownEditingHosts = new Set(context.editingHostEnvironmentIds ?? []);
  const isEditingHostProfile =
    context.environmentType === "eh" && context.environmentId === options.id;
  if (!knownEditingHosts.has(options.id) && !isEditingHostProfile) {
    const env = (await fetchEnvironment(
      { accessToken: context.token, baseUrl: context.baseUrl },
      options.id
    )) as Record<string, unknown>;
    const type = resolveEnvironmentType(env);
    if (type && type !== "eh") {
      throw inputError(`Environment ${options.id} is not an editing host.`);
    }
  }
  const result = await createEnvironmentDeployment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id,
    options.redeploy
  );
  const deploymentId = printDeploymentResult(logger, context, "deploy.editing-host.deploy", result);
  if (deploymentId && !options.noWatch) {
    await runDeployDeploymentsWatch({
      ...options,
      id: deploymentId,
      waitForPostActions: options.waitForPostActions,
    });
  }
};
