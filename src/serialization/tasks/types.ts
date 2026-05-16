/**
 * Option types for `scai provision serialization` task runners (and the
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

/**
 * Progress event emitted by runPull / runPush / runDiff per database
 * iteration. External orchestrators (e.g. `scai mcp serve`) subscribe
 * via `SyncOptions.emit` / `DiffOptions.emit` to forward live progress
 * to a client.
 */
export type SerializationProgressEvent =
  | { kind: "database-start"; database: string; subtreeCount: number }
  | { kind: "database-changes-detected"; database: string; changes: number }
  | { kind: "database-applied"; database: string; changes: number; whatIf: boolean }
  | { kind: "database-skipped"; database: string; reason: string };

export type SerializationProgressShape = {
  /**
   * Optional progress callback fired at major checkpoints inside the
   * per-database loop. Pure side-channel — never load-bearing.
   */
  emit?: (event: SerializationProgressEvent) => void;
  /**
   * Cooperative cancellation. When the signal fires, the task stops
   * between databases (in-flight requests are not interrupted) and
   * returns. Partial filesystem / tenant state is left in place — the
   * task is best-effort cancellable, like `deploy_run_cancel`.
   */
  signal?: AbortSignal;
};

export type SyncOptions = CommonOptions &
  SerializationProgressShape & {
    environmentName?: string;
    whatIf?: boolean;
    force?: boolean;
    skipValidation?: boolean;
    allowWrite?: boolean;
    publish?: boolean;
    targets?: string[];
    useDebugSignatures?: boolean;
  };

export type DiffOptions = CommonOptions &
  SerializationProgressShape & {
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
