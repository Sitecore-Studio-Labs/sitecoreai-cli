import type { FilesystemTreeSpec } from "../serialization/tree-spec";
import type { FieldFilter, RolePredicateItem, UserPredicateItem } from "../serialization/types";

export type SerializationRootConfiguration = {
  defaultMaxRelativeItemPathLength: number;
  defaultModuleRelativeSerializationPath: string;
  removeOrphansForRoles: boolean;
  removeOrphansForUsers: boolean;
  continueOnItemFailure: boolean;
  excludedFields: FieldFilter[];
};

export type Settings = {
  telemetryEnabled: boolean;
  cacheAuthenticationToken: boolean;
  versionComparisonEnabled: boolean;
  apiClientTimeoutInMinutes: number;
};

export type EnvironmentConfiguration = {
  name?: string;
  host?: string;
  authority?: string;
  environmentType?: "cm" | "eh";
  allowWrite?: boolean;
  accessToken?: string;
  refreshToken?: string;
  refreshTokenParameters?: Record<string, string>;
  expiresIn?: number | null;
  lastUpdated?: string | null;
  deployToken?: string;
  deployTokenExpiresIn?: number | null;
  deployTokenLastUpdated?: string | null;
  editingHostEnvironmentIds?: string[];
  organizationId?: string;
  tenantId?: string;
  projectId?: string;
  environmentId?: string;
  clientId?: string;
  clientSecret?: string;
  useClientCredentials?: boolean;
  variables?: Record<string, string>;
  audience?: string;
  ref?: string;
  cacheAuthenticationToken?: boolean;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * template items. Tenant-specific because each site has its own
   * `/sitecore/templates/Project/<site>/Components` location.
   *
   * Used as fallback when the CLI flag `--templates-root` is not passed.
   */
  templatesRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * rendering items. Tenant-specific.
   *
   * Used as fallback when the CLI flag `--renderings-root` is not passed.
   */
  renderingsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * partial-design items (Phase 4). Typically
   * `/sitecore/content/<site>/Presentation/Partial Designs`.
   *
   * Optional — only `PartialDesignRecipe` compilation requires it.
   */
  partialDesignsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * page-design items (Phase 4). Typically
   * `/sitecore/content/<site>/Presentation/Page Designs`.
   *
   * Optional — only `PageDesignRecipe` compilation requires it. Also
   * used by `runRecipePush` to seed `crossRecipeRefs` so the cross-
   * recipe `TemplatesMapping` aggregate op can resolve its target.
   */
  pageDesignsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * shared content items (Phase 4). Typically
   * `/sitecore/content/<site>/Data` or a sub-bucket.
   *
   * Optional — only `ContentItemRecipe` compilation requires it.
   */
  contentItemsRoot?: string;
};

export type RootConfiguration = {
  modules: string[];
  serialization: SerializationRootConfiguration;
  settings: Settings;
  environments: Record<string, EnvironmentConfiguration>;
  physicalPath: string;
  defaultEnvironment: string;
  /**
   * Globs (relative to the project root) that locate `.recipe.ts` /
   * `.recipe.json` files for `scai recipe compile|plan|push`. When the
   * commands run without `--input`, they fall back to this glob set.
   * Defaults to `["recipes/**\/*.recipe.ts"]` if unset.
   */
  recipes: string[];
};

export type RootConfigurationFile = {
  $schema?: string;
  modules?: string[];
  serialization?: Partial<SerializationRootConfiguration>;
  settings?: Partial<Settings>;
  envProfiles?: Record<string, EnvironmentConfiguration>;
  defaultEnvProfile?: string;
  /** Globs locating recipe files. See `RootConfiguration.recipes`. */
  recipes?: string[];
  [key: string]: unknown;
};

export type UserConfiguration = {
  envProfiles?: Record<string, EnvironmentConfiguration>;
  defaultEnvProfile?: string;
};

export type SerializationModuleConfigurationItems = {
  path?: string;
  includes: FilesystemTreeSpec[];
  excludedFields: FieldFilter[];
};

export type SerializationModuleConfiguration = {
  namespace: string;
  description?: string;
  references: string[];
  items: SerializationModuleConfigurationItems;
  roles: RolePredicateItem[];
  users: UserPredicateItem[];
  tags: string[];
  sourceIdentifier: string;
};

export const DEFAULT_SERIALIZATION: SerializationRootConfiguration = {
  defaultMaxRelativeItemPathLength: 120,
  defaultModuleRelativeSerializationPath: "serialization",
  removeOrphansForRoles: true,
  removeOrphansForUsers: true,
  continueOnItemFailure: false,
  excludedFields: [],
};

export const DEFAULT_SETTINGS: Settings = {
  telemetryEnabled: false,
  cacheAuthenticationToken: true,
  versionComparisonEnabled: true,
  apiClientTimeoutInMinutes: 5,
};

export const DEFAULT_ENVIRONMENT = "default";

export const DEFAULT_RECIPES_GLOBS: string[] = ["recipes/**/*.recipe.ts"];
