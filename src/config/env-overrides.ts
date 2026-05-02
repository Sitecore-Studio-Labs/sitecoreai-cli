import type { EnvironmentConfiguration, RootConfigurationFile } from "./types";

const toBoolean = (value?: string): boolean | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
};

const normalizeEnvKey = (name: string): string =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getEnvOverride = (
  envName: string,
  key: string,
  includeGlobal: boolean
): string | undefined => {
  const scopedKey = `SITECOREAI_ENV_${normalizeEnvKey(envName)}_${key}`;
  const scopedValue = process.env[scopedKey];
  if (scopedValue && scopedValue.trim().length > 0) {
    return scopedValue.trim();
  }
  if (!includeGlobal) {
    return undefined;
  }
  const globalKey = `SITECOREAI_${key}`;
  const globalValue = process.env[globalKey];
  if (globalValue && globalValue.trim().length > 0) {
    return globalValue.trim();
  }
  return undefined;
};

export const applyEnvOverrides = (
  envName: string,
  env: EnvironmentConfiguration,
  includeGlobal: boolean
): EnvironmentConfiguration => {
  const overrides: Partial<EnvironmentConfiguration> = {};
  const allowWrite = toBoolean(getEnvOverride(envName, "ALLOW_WRITE", includeGlobal));
  if (allowWrite !== undefined) {
    overrides.allowWrite = allowWrite;
  }
  const useClientCredentials = toBoolean(
    getEnvOverride(envName, "USE_CLIENT_CREDENTIALS", includeGlobal)
  );
  if (useClientCredentials !== undefined) {
    overrides.useClientCredentials = useClientCredentials;
  }

  const host = getEnvOverride(envName, "CM_HOST", includeGlobal);
  if (host !== undefined) {
    overrides.host = host;
  }
  const authority = getEnvOverride(envName, "AUTHORITY", includeGlobal);
  if (authority !== undefined) {
    overrides.authority = authority;
  }
  const audience = getEnvOverride(envName, "AUDIENCE", includeGlobal);
  if (audience !== undefined) {
    overrides.audience = audience;
  }
  const clientId = getEnvOverride(envName, "CLIENT_ID", includeGlobal);
  if (clientId !== undefined) {
    overrides.clientId = clientId;
  }
  const clientSecret = getEnvOverride(envName, "CLIENT_SECRET", includeGlobal);
  if (clientSecret !== undefined) {
    overrides.clientSecret = clientSecret;
  }
  const deployToken = getEnvOverride(envName, "DEPLOY_TOKEN", includeGlobal);
  if (deployToken !== undefined) {
    overrides.deployToken = deployToken;
  }
  // CM/admin access token override — useful when keychain storage is
  // unreliable (e.g. headless CI, sandboxed shells) or for one-off
  // debugging. Read by `getAccessToken` in serialization/sitecore-api/auth.ts
  // before falling through to client-credentials.
  const accessToken = getEnvOverride(envName, "ACCESS_TOKEN", includeGlobal);
  if (accessToken !== undefined) {
    overrides.accessToken = accessToken;
  }
  // Recipe parent paths — read by `resolveRecipeRoots` in
  // src/recipe/tasks/shared.ts when --templates-root / --renderings-root
  // CLI flags are absent.
  const templatesRoot = getEnvOverride(envName, "TEMPLATES_ROOT", includeGlobal);
  if (templatesRoot !== undefined) {
    overrides.templatesRoot = templatesRoot;
  }
  const renderingsRoot = getEnvOverride(envName, "RENDERINGS_ROOT", includeGlobal);
  if (renderingsRoot !== undefined) {
    overrides.renderingsRoot = renderingsRoot;
  }
  // Phase 2 per-site folder layout roots — read by `runRecipePush` /
  // `runRecipeCompile` to wire
  // `CompileContext.{componentsRoot, contentModelsRoot}` so recipes
  // with `section:` land at `<componentsRoot>/<section>/<Component>`
  // and content templates land under `<contentModelsRoot>`.
  const componentsRoot = getEnvOverride(envName, "COMPONENTS_ROOT", includeGlobal);
  if (componentsRoot !== undefined) {
    overrides.componentsRoot = componentsRoot;
  }
  const contentModelsRoot = getEnvOverride(envName, "CONTENT_MODELS_ROOT", includeGlobal);
  if (contentModelsRoot !== undefined) {
    overrides.contentModelsRoot = contentModelsRoot;
  }
  // Phase 4 composition roots — read by `runRecipePush` to wire
  // `CompileContext.{partialDesignsRoot, pageDesignsRoot, contentItemsRoot}`
  // and to seed `crossRecipeRefs[PAGE_DESIGNS_ROOT_REF_KEY]`.
  const partialDesignsRoot = getEnvOverride(envName, "PARTIAL_DESIGNS_ROOT", includeGlobal);
  if (partialDesignsRoot !== undefined) {
    overrides.partialDesignsRoot = partialDesignsRoot;
  }
  const pageDesignsRoot = getEnvOverride(envName, "PAGE_DESIGNS_ROOT", includeGlobal);
  if (pageDesignsRoot !== undefined) {
    overrides.pageDesignsRoot = pageDesignsRoot;
  }
  const contentItemsRoot = getEnvOverride(envName, "CONTENT_ITEMS_ROOT", includeGlobal);
  if (contentItemsRoot !== undefined) {
    overrides.contentItemsRoot = contentItemsRoot;
  }
  const organizationId = getEnvOverride(envName, "ORGANIZATION_ID", includeGlobal);
  if (organizationId !== undefined) {
    overrides.organizationId = organizationId;
  }
  const tenantId = getEnvOverride(envName, "TENANT_ID", includeGlobal);
  if (tenantId !== undefined) {
    overrides.tenantId = tenantId;
  }
  const projectId = getEnvOverride(envName, "PROJECT_ID", includeGlobal);
  if (projectId !== undefined) {
    overrides.projectId = projectId;
  }
  const environmentId = getEnvOverride(envName, "ENVIRONMENT_ID", includeGlobal);
  if (environmentId !== undefined) {
    overrides.environmentId = environmentId;
  }
  const environmentType = getEnvOverride(envName, "ENVIRONMENT_TYPE", includeGlobal);
  if (environmentType !== undefined) {
    const normalized = environmentType.trim().toLowerCase();
    if (normalized === "cm" || normalized === "eh") {
      overrides.environmentType = normalized as EnvironmentConfiguration["environmentType"];
    }
  }

  return { ...env, ...overrides };
};

const stripAuthenticationTokens = (env: EnvironmentConfiguration): EnvironmentConfiguration => {
  const sanitized = { ...env };
  delete sanitized.accessToken;
  delete sanitized.refreshToken;
  delete sanitized.refreshTokenParameters;
  delete sanitized.expiresIn;
  delete sanitized.lastUpdated;
  delete sanitized.deployToken;
  delete sanitized.clientSecret;
  return sanitized;
};

const stripAuthenticationTokensFromProfiles = (
  envProfiles: Record<string, EnvironmentConfiguration>
): Record<string, EnvironmentConfiguration> =>
  Object.fromEntries(
    Object.entries(envProfiles).map(([name, env]) => [name, stripAuthenticationTokens(env)])
  );

export const stripAuthenticationTokensFromConfig = (
  config: RootConfigurationFile
): RootConfigurationFile => {
  if (!config.envProfiles) {
    return config;
  }
  const sanitizedProfiles = stripAuthenticationTokensFromProfiles(config.envProfiles);
  return {
    ...config,
    envProfiles: sanitizedProfiles,
  };
};
