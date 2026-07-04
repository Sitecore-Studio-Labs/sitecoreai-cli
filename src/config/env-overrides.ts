import type { EnvironmentConfiguration, RootConfigurationFile } from "./types";
import { trimEdgeChar } from "../shared/strings";

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
  trimEdgeChar(
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_"),
    "_"
  );

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

/**
 * Plain string-valued env overrides: each maps `SITECOREAI_<KEY>` (and
 * the env-scoped variant) straight onto a config field of the same
 * string type. Kept as a table so the merge loop stays flat — the
 * per-field rationale comments live with their consumers, not here.
 *
 * Notably absent: CLIENT_SECRET (secrets never live on the env profile;
 * the auth layer reads `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` directly).
 */
const STRING_OVERRIDE_FIELDS = [
  ["CM_HOST", "host"],
  ["AUTHORITY", "authority"],
  ["AUDIENCE", "audience"],
  ["CLIENT_ID", "clientId"],
  ["DEPLOY_TOKEN", "deployToken"],
  ["ACCESS_TOKEN", "accessToken"],
  ["TEMPLATES_ROOT", "templatesRoot"],
  ["RENDERINGS_ROOT", "renderingsRoot"],
  ["COMPONENTS_ROOT", "componentsRoot"],
  ["CONTENT_MODELS_ROOT", "contentModelsRoot"],
  ["PARTIAL_DESIGNS_ROOT", "partialDesignsRoot"],
  ["PAGE_DESIGNS_ROOT", "pageDesignsRoot"],
  ["CONTENT_ITEMS_ROOT", "contentItemsRoot"],
  ["MEDIA_LIBRARY_ROOT", "mediaLibraryRoot"],
  ["HEADLESS_VARIANTS_ROOT", "headlessVariantsRoot"],
  ["AVAILABLE_RENDERINGS_ROOT", "availableRenderingsRoot"],
  ["PRESENTATION_STYLES_ROOT", "presentationStylesRoot"],
  ["ENUMERATIONS_ROOT", "enumerationsRoot"],
  ["PAGE_TEMPLATES_ROOT", "pageTemplatesRoot"],
  ["PAGES_ROOT", "pagesRoot"],
  ["PLACEHOLDER_SETTINGS_ROOT", "placeholderSettingsRoot"],
  ["ORGANIZATION_ID", "organizationId"],
  ["TENANT_ID", "tenantId"],
  ["PROJECT_ID", "projectId"],
  ["ENVIRONMENT_ID", "environmentId"],
] as const satisfies ReadonlyArray<readonly [string, keyof EnvironmentConfiguration]>;

/** Boolean env overrides parsed through `toBoolean`. */
const BOOLEAN_OVERRIDE_FIELDS = [
  ["ALLOW_WRITE", "allowWrite"],
  ["USE_CLIENT_CREDENTIALS", "useClientCredentials"],
  ["PRODUCTION", "production"],
  ["ALLOW_FULL_REPUBLISH", "allowFullRepublish"],
] as const satisfies ReadonlyArray<readonly [string, keyof EnvironmentConfiguration]>;

/** Comma-separated env overrides split into a trimmed, non-empty list. */
const LIST_OVERRIDE_FIELDS = [
  ["PLACEHOLDER_SETTINGS_ROOTS", "placeholderSettingsRoots"],
  ["ALLOWED_CI_PIPELINES", "allowedCiPipelines"],
] as const satisfies ReadonlyArray<readonly [string, keyof EnvironmentConfiguration]>;

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const applyStringOverrides = (
  overrides: Record<string, unknown>,
  envName: string,
  includeGlobal: boolean
): void => {
  for (const [key, field] of STRING_OVERRIDE_FIELDS) {
    const value = getEnvOverride(envName, key, includeGlobal);
    if (value !== undefined) {
      overrides[field] = value;
    }
  }
};

const applyBooleanOverrides = (
  overrides: Record<string, unknown>,
  envName: string,
  includeGlobal: boolean
): void => {
  for (const [key, field] of BOOLEAN_OVERRIDE_FIELDS) {
    const value = toBoolean(getEnvOverride(envName, key, includeGlobal));
    if (value !== undefined) {
      overrides[field] = value;
    }
  }
};

const applyListOverrides = (
  overrides: Record<string, unknown>,
  envName: string,
  includeGlobal: boolean
): void => {
  for (const [key, field] of LIST_OVERRIDE_FIELDS) {
    const value = getEnvOverride(envName, key, includeGlobal);
    if (value !== undefined) {
      overrides[field] = splitList(value);
    }
  }
};

const applyEnvironmentTypeOverride = (
  overrides: Partial<EnvironmentConfiguration>,
  envName: string,
  includeGlobal: boolean
): void => {
  const environmentType = getEnvOverride(envName, "ENVIRONMENT_TYPE", includeGlobal);
  if (environmentType === undefined) {
    return;
  }
  const normalized = environmentType.trim().toLowerCase();
  if (normalized === "cm" || normalized === "eh") {
    overrides.environmentType = normalized as EnvironmentConfiguration["environmentType"];
  }
};

export const applyEnvOverrides = (
  envName: string,
  env: EnvironmentConfiguration,
  includeGlobal: boolean
): EnvironmentConfiguration => {
  const overrides: Partial<EnvironmentConfiguration> = {};
  const bag = overrides as Record<string, unknown>;

  applyStringOverrides(bag, envName, includeGlobal);
  applyBooleanOverrides(bag, envName, includeGlobal);
  applyListOverrides(bag, envName, includeGlobal);
  applyEnvironmentTypeOverride(overrides, envName, includeGlobal);

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
  // `clientSecret` is intentionally not handled — it is no longer a
  // field on `EnvironmentConfiguration`. Legacy configs that still carry
  // it are scrubbed below.
  delete (sanitized as Record<string, unknown>).clientSecret;
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
