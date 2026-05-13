/**
 * Option types for `scai serialization` task runners (and the
 * env-management tasks that share the serialization namespace —
 * `init`, `login`, `logout`, etc.). Deploy-specific option types
 * (`Deploy*Options`) live in `@/deploy/tasks/types`.
 */

export { CommonOptions } from "@/shared/cli-options";
import type { CommonOptions } from "@/shared/cli-options";

export type LogoutOptions = CommonOptions & {
  environmentName?: string;
  all?: boolean;
};

export type SyncOptions = CommonOptions & {
  environmentName?: string;
  whatIf?: boolean;
  force?: boolean;
  skipValidation?: boolean;
  allowWrite?: boolean;
  publish?: boolean;
  targets?: string[];
  useDebugSignatures?: boolean;
};

export type DiffOptions = CommonOptions & {
  source: string;
  destination: string;
  push?: boolean;
  whatIf?: boolean;
  allowWrite?: boolean;
  force?: boolean;
  path?: string;
  sourceDatabase?: string;
  destinationDatabase?: string;
};

export type ExplainOptions = CommonOptions & {
  path: string;
  database: string;
};

export type WatchOptions = CommonOptions & {
  environmentName?: string;
  skipPull?: boolean;
  allowFileChanges?: boolean;
};

export type PackageCreateOptions = CommonOptions & {
  output: string;
  overwrite?: boolean;
};

export type PackageInstallOptions = CommonOptions & {
  package: string;
  environmentName?: string;
  whatIf?: boolean;
  publish?: boolean;
  authority?: string;
  cm?: string;
  clientId?: string;
  clientSecret?: string;
};

export type ConnectOptions = CommonOptions & {
  environmentName?: string;
  cm?: string;
  host?: string;
  ref?: string;
  allowWrite?: boolean;
  skipDeployLookup?: boolean;
  organizationId?: string;
  tenantId?: string;
  organization?: string;
  project?: string;
  environment?: string;
  deployToken?: string;
  clientId?: string;
  clientSecret?: string;
  useClientCredentials?: boolean;
  setDefault?: boolean;
  wizard?: boolean;
};
