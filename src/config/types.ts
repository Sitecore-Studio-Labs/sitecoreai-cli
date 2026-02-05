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
};

export type RootConfiguration = {
  modules: string[];
  serialization: SerializationRootConfiguration;
  settings: Settings;
  environments: Record<string, EnvironmentConfiguration>;
  physicalPath: string;
  defaultEnvironment: string;
};

export type RootConfigurationFile = {
  $schema?: string;
  modules?: string[];
  serialization?: Partial<SerializationRootConfiguration>;
  settings?: Partial<Settings>;
  envProfiles?: Record<string, EnvironmentConfiguration>;
  defaultEnvProfile?: string;
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
