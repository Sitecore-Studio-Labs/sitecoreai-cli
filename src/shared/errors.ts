/**
 * scai's typed error envelope.
 *
 * `ScaiError` is the canonical class. `CliError` is a deprecated alias
 * kept for one major version so consumers of `@sitecoreai-labs/cli/errors`
 * (added in 0.x) can migrate without breakage. The factory + converter +
 * code type follow the same convention:
 *
 *   - `ScaiError` ← was `CliError`
 *   - `ScaiErrorCode` ← was `CliErrorCode`
 *   - `createScaiError(...)` ← was `createCliError(...)`
 *   - `toScaiError(...)` ← was `toCliError(...)`
 *
 * The legacy `Cli*` names re-export the new symbols and will be removed
 * in the next major version.
 */

export type ScaiErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "INPUT_INVALID"
  | "AUTH_REQUIRED"
  | "AUTH_BRAND_REQUIRED"
  | "AUTH_DENIED"
  | "POLICY_DENIED"
  | "NETWORK"
  | "ENV_NOT_FOUND"
  | "DEPLOY_FAILED"
  | "DEPLOY_CANCELED"
  | "SITES_API_FAILED"
  | "BRAND_API_FAILED"
  | "BRIEF_API_FAILED"
  | "CAMPAIGN_API_FAILED"
  | "AGENTS_API_FAILED"
  | "CANCELLED"
  | "UNKNOWN";

/**
 * Who can clear a failure — the classification an agent reads to decide
 * whether to act itself, hand off to a human, or retry.
 *
 * - `agent` — fixable without a human: enroll an environment, pass a
 *   flag, correct an input.
 * - `needs-human-terminal` — a human must run a command in an
 *   interactive terminal; scai refuses the operation for non-human
 *   callers (credential provisioning: `setup login`, `setup env`).
 * - `transient-retry` — a transient failure; wait briefly and retry.
 */
export type RemediationActor = "agent" | "needs-human-terminal" | "transient-retry";

/**
 * Machine-actionable remediation attached to a {@link ScaiError}. Where
 * `hint` is prose for a human, `remediation` is structured so an agent
 * (CLI JSON consumer, MCP client) can route the failure without parsing
 * free text.
 */
export interface Remediation {
  /** Who can clear this failure. */
  actor: RemediationActor;
  /** The concrete fix — a command to run, or a short imperative action. */
  fix: string;
  /** Optional extra context: why a human is needed, what to retry, etc. */
  detail?: string;
}

/**
 * A three-way-merge cell that diverged on the tenant. Carried on a
 * `POLICY_DENIED` {@link ScaiError} so a consumer can route a conflict
 * block structurally instead of regexing `details` strings. Shape is
 * kept inline (not imported from `@/sync/contract`) because `sync`
 * depends on this module — importing back would cycle. It is
 * structurally identical to `SyncConflictCell` and validated against it
 * at the contract boundary.
 */
export interface MergeConflictCell {
  path: string;
  classification: "cms-edit" | "conflict";
}

/**
 * Narrow a kind's loosely-typed `policyErrors` bag (carried on
 * `RecipeChange.meta` as `Array<{ path, classification: string }>`) into
 * the structured {@link MergeConflictCell}[] the error envelope ships.
 * Drops any entry whose classification isn't a gating one — only
 * `cms-edit` / `conflict` block a push, so only those are conflicts.
 */
export const toMergeConflicts = (
  policyErrors: ReadonlyArray<{ path: string; classification: string }> | undefined
): MergeConflictCell[] =>
  (policyErrors ?? []).flatMap((entry) =>
    entry.classification === "cms-edit" || entry.classification === "conflict"
      ? [{ path: entry.path, classification: entry.classification }]
      : []
  );

export class ScaiError extends Error {
  code: ScaiErrorCode;
  exitCode: number;
  hint?: string;
  details?: string[];
  remediation?: Remediation;
  /** Structured three-way-merge conflicts on a `POLICY_DENIED` block. */
  conflicts?: MergeConflictCell[];

  constructor(
    message: string,
    options: {
      code?: ScaiErrorCode;
      exitCode?: number;
      hint?: string;
      details?: string[];
      remediation?: Remediation;
      conflicts?: MergeConflictCell[];
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "ScaiError";
    this.code = options.code ?? "UNKNOWN";
    this.exitCode = options.exitCode ?? 1;
    this.hint = options.hint;
    this.details = options.details;
    this.remediation = options.remediation;
    this.conflicts = options.conflicts;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

const exitCodeFor = (code: ScaiErrorCode): number => {
  switch (code) {
    case "CONFIG_NOT_FOUND":
    case "CONFIG_INVALID":
    case "INPUT_INVALID":
      return 2;
    case "AUTH_REQUIRED":
    case "AUTH_BRAND_REQUIRED":
    case "AUTH_DENIED":
    case "POLICY_DENIED":
      return 3;
    case "NETWORK":
      return 4;
    case "ENV_NOT_FOUND":
      return 5;
    case "DEPLOY_FAILED":
    case "DEPLOY_CANCELED":
      return 6;
    case "SITES_API_FAILED":
    case "BRAND_API_FAILED":
      return 7;
    case "BRIEF_API_FAILED":
    case "CAMPAIGN_API_FAILED":
    case "AGENTS_API_FAILED":
      return 8;
    case "CANCELLED":
      return 130;
    default:
      return 1;
  }
};

export const toScaiError = (error: unknown): ScaiError => {
  if (error instanceof ScaiError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ScaiError(message, { code: "UNKNOWN", exitCode: exitCodeFor("UNKNOWN") });
};

export const withHint = (error: ScaiError, hint: string): ScaiError =>
  new ScaiError(error.message, {
    code: error.code,
    exitCode: error.exitCode,
    hint,
    details: error.details,
    remediation: error.remediation,
    conflicts: error.conflicts,
  });

export const createScaiError = (
  message: string,
  code: ScaiErrorCode,
  options: {
    hint?: string;
    details?: string[];
    remediation?: Remediation;
    conflicts?: MergeConflictCell[];
  } = {}
): ScaiError =>
  new ScaiError(message, {
    code,
    exitCode: exitCodeFor(code),
    hint: options.hint,
    details: options.details,
    remediation: options.remediation,
    conflicts: options.conflicts,
  });

/**
 * @deprecated Use {@link ScaiErrorCode}. Removed in the next major.
 */
export type CliErrorCode = ScaiErrorCode;

/**
 * @deprecated Use {@link ScaiError}. Removed in the next major.
 *
 * `CliError` and `ScaiError` reference the **same class** — they're not
 * separate types — so `instanceof CliError` and `instanceof ScaiError`
 * both work against any thrown error from scai, regardless of which
 * name the throwing code used. The single `export { ... as CliError }`
 * form binds both the value (constructor) and the type at once.
 */
export { ScaiError as CliError };

/**
 * @deprecated Use {@link createScaiError}. Removed in the next major.
 */
export const createCliError = createScaiError;

/**
 * @deprecated Use {@link toScaiError}. Removed in the next major.
 */
export const toCliError = toScaiError;
