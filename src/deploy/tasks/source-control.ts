import {
  fetchSourceControlIntegrations,
  fetchSourceControlIntegrationState,
  fetchSourceControlAccessToken,
  validateSourceControlIntegration,
  validateSourceControlRepository,
  fetchSourceControlRepository,
  fetchSourceControlRepositoryBranches,
  fetchSourceControlTemplates,
  createSourceControlRepository,
  createSourceControlRepositoryGithub,
  fetchSourceControlProviders,
  fetchSourceControlIntegration,
  deleteSourceControlIntegration,
} from "@/deploy/api/source-control";
import {
  getDeployContext,
  inputError,
  printDeployResultWithContext,
  printDeployWhatIf,
  toLogger,
} from "./shared";
import type {
  DeployBaseOptions,
  DeploySourceControlOptions,
  DeploySourceControlRepositoryBranchesOptions,
  DeploySourceControlRepositoryCreateTemplateOptions,
  DeploySourceControlRepositoryOptions,
  DeploySourceControlTemplatesOptions,
  DeploySourceControlValidateOptions,
} from "./types";

export const runDeploySourceControlList = async (options: DeployBaseOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const result = await fetchSourceControlIntegrations({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  printDeployResultWithContext(logger, context, "deploy.source-control.list", result);
};

export const runDeploySourceControlState = async (options: DeployBaseOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const result = await fetchSourceControlIntegrationState({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  printDeployResultWithContext(logger, context, "deploy.source-control.state", result);
};

export const runDeploySourceControlAccessToken = async (
  options: DeploySourceControlOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Source control integration ID is required. Use --id.");
  }
  const result = await fetchSourceControlAccessToken(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id
  );
  printDeployResultWithContext(logger, context, "deploy.source-control.access-token", result);
};

export const runDeploySourceControlValidate = async (
  options: DeploySourceControlValidateOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const integrationId = options.integrationId ?? options.id;
  if (!integrationId) {
    throw inputError("Source control integration ID is required. Use --id.");
  }
  const result = await validateSourceControlIntegration(
    { accessToken: context.token, baseUrl: context.baseUrl },
    {
      integrationId,
    }
  );
  printDeployResultWithContext(logger, context, "deploy.source-control.validate", result);
};

export const runDeploySourceControlRepositoryGet = async (
  options: DeploySourceControlRepositoryOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.integrationId || !options.repositoryId) {
    throw inputError("Integration ID and repository ID are required.");
  }
  const result = await fetchSourceControlRepository(
    { accessToken: context.token, baseUrl: context.baseUrl },
    {
      IntegrationId: options.integrationId,
      RepositoryId: options.repositoryId,
    }
  );
  printDeployResultWithContext(logger, context, "deploy.source-control.repository.get", result);
};

export const runDeploySourceControlRepositoryBranches = async (
  options: DeploySourceControlRepositoryBranchesOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.integrationId || !options.repositoryName) {
    throw inputError("Integration ID and repository name are required.");
  }
  const result = await fetchSourceControlRepositoryBranches(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.repositoryName,
    {
      IntegrationId: options.integrationId,
    }
  );
  printDeployResultWithContext(
    logger,
    context,
    "deploy.source-control.repository.branches",
    result
  );
};

export const runDeploySourceControlTemplates = async (
  options: DeploySourceControlTemplatesOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const query = options.provider ? { provider: options.provider } : undefined;
  const result = await fetchSourceControlTemplates(
    { accessToken: context.token, baseUrl: context.baseUrl },
    query
  );
  printDeployResultWithContext(logger, context, "deploy.source-control.templates", result);
};

export const runDeploySourceControlRepositoryValidate = async (
  options: DeploySourceControlRepositoryOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.integrationId || !options.repositoryName) {
    throw inputError("Integration ID and repository name are required.");
  }
  const result = await validateSourceControlRepository(
    { accessToken: context.token, baseUrl: context.baseUrl },
    {
      integrationId: options.integrationId,
      repositoryName: options.repositoryName,
    }
  );
  printDeployResultWithContext(
    logger,
    context,
    "deploy.source-control.repository.validate",
    result
  );
};

export const runDeploySourceControlRepositoryCreateFromTemplate = async (
  options: DeploySourceControlRepositoryCreateTemplateOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.provider) {
    throw inputError("Provider is required. Use --provider.");
  }
  if (!options.templateRepository || !options.templateOwner) {
    throw inputError("Template repository and owner are required.");
  }
  if (!options.repositoryName || !options.owner || !options.integrationId) {
    throw inputError("Repository name, owner, and integration ID are required.");
  }
  const input = {
    provider: options.provider,
    templateRepository: options.templateRepository,
    templateOwner: options.templateOwner,
    repositoryName: options.repositoryName,
    owner: options.owner,
    integrationId: options.integrationId,
    description: options.description,
    privateRepository: options.privateRepository,
    includeAllBranches: options.includeAllBranches,
  };
  if (options.whatIf) {
    const isGithub = options.provider.toLowerCase() === "github";
    printDeployWhatIf(logger, context, "deploy.source-control.repository.create", {
      method: "POST",
      path: isGithub
        ? "/api/sourcecontrol/v1/repository/github"
        : "/api/sourcecontrol/v1/repository",
      body: input,
    });
    return;
  }
  const result =
    options.provider.toLowerCase() === "github"
      ? await createSourceControlRepositoryGithub(
          { accessToken: context.token, baseUrl: context.baseUrl },
          input
        )
      : await createSourceControlRepository(
          { accessToken: context.token, baseUrl: context.baseUrl },
          input
        );
  printDeployResultWithContext(logger, context, "deploy.source-control.repository.create", result);
};

export const runDeploySourceControlProviders = async (
  options: DeploySourceControlTemplatesOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const result = await fetchSourceControlProviders({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  printDeployResultWithContext(logger, context, "deploy.source-control.providers", result);
};

export const runDeploySourceControlGet = async (
  options: DeploySourceControlOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const id = options.id ?? context.organizationId;
  if (!id) {
    throw inputError("Source control integration ID is required. Use --id.");
  }
  const result = await fetchSourceControlIntegration(
    { accessToken: context.token, baseUrl: context.baseUrl },
    id
  );
  printDeployResultWithContext(logger, context, "deploy.source-control.get", result);
};

export const runDeploySourceControlDelete = async (
  options: DeploySourceControlOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const id = options.id ?? context.organizationId;
  if (!id) {
    throw inputError("Source control integration ID is required. Use --id.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.source-control.delete", {
      method: "DELETE",
      path: `/api/sourcecontrol/v1/integration/${id}`,
    });
    return;
  }
  const result = await deleteSourceControlIntegration(
    { accessToken: context.token, baseUrl: context.baseUrl },
    id
  );
  printDeployResultWithContext(logger, context, "deploy.source-control.delete", result);
};
