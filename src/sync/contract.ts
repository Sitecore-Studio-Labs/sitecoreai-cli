/**
 * The scai ↔ orchestrator **sync contract** — the single, versioned
 * source of truth for the typed surface scai emits under `--json` for
 * push / pull / diff, and the capability handshake it answers.
 *
 * ## Why this exists
 *
 * scai is spawned as a subprocess by the orchestrator. Historically the
 * orchestrator parsed scai's human-readable stdout with regexes
 * (`/not found/`, `/does not exist yet/`), read resolved Sitecore UUIDs
 * from a side-channel file (`--identities-out`), and gated newer flags
 * behind `SCAI_HAS_*` env booleans. The registry, one hop further out,
 * regexed the error string (`/conflict|cms-edit|policy_denied/`) to
 * decide whether to show the conflict-resolution UI. Every contract
 * change was a three-repo lockstep with no compile- or run-time signal
 * when the lockstep broke — so drift surfaced at runtime, per entity, in
 * production.
 *
 * The irony the audit surfaced: scai already produces this data in typed
 * form. `classifyHashes` is shared, conflicts already throw a typed
 * `ScaiError(POLICY_DENIED)`, per-cell `classification` already rides on
 * `RecipeChange.meta`, and `ApplyResult` already carries `identities`.
 * The only gap was that the push/pull *success* path flattened all of it
 * to text at the CLI boundary. This module closes that gap: it defines
 * the typed shapes, and {@link buildSyncResult} projects scai's existing
 * outcome objects into them.
 *
 * ## The contract
 *
 * Downstream consumers (orchestrator, registry) **mirror** the `*Schema`
 * Zod validators in their own repos and check {@link SYNC_CONTRACT_VERSION}
 * at the process boundary. A version they don't recognize is a loud,
 * fail-fast error — never a silent degrade. We deliberately do NOT ship a
 * shared published package today (scai is a closed binary; the consumers
 * already mirror recipe schemas the same way). If scai later exports this
 * as a stable subpath, the mirrors collapse into an import — a mechanical
 * change that the `contractVersion` guard makes safe.
 *
 * Bump {@link SYNC_CONTRACT_VERSION} only when a consumer that validates
 * against the *old* version would mis-handle the *new* payload. Additive,
 * optional fields don't need a bump; renames / removals / semantic
 * changes do.
 */
import { z } from "zod";

import type { PushOutcome, SyncMode } from "./engine";
import type { KindRef, ResolvedIdentity } from "./kind";
import { summarizePlan, type RecipePlan } from "./plan";

/**
 * Contract version. Bump on a breaking change to any shape below.
 * Consumers compare against this and refuse to proceed on a mismatch.
 */
export const SYNC_CONTRACT_VERSION = "1" as const;
export type SyncContractVersion = typeof SYNC_CONTRACT_VERSION;

/** Mirror of `FieldClassification` (sync/baseline) as a Zod enum. */
export const FieldClassificationSchema = z.enum([
  "first-push",
  "recipe-change",
  "cms-edit",
  "conflict",
]);

/** Mirror of `ChangeKind` (sync/plan) as a Zod enum. */
export const ChangeKindSchema = z.enum(["create", "update", "delete", "noop"]);

/**
 * One change in a serialized plan. A pared-down, wire-stable projection
 * of `RecipeChange` — the kind-private `meta` bag is dropped; only the
 * per-cell `classification` is lifted out of it because that's the one
 * piece a consumer needs to render "this cell had a tenant edit".
 */
export const SyncChangeSchema = z.object({
  kind: ChangeKindSchema,
  path: z.string(),
  summary: z.string(),
  classification: FieldClassificationSchema.optional(),
  /** Prior value — present on update/delete. Optional; can be large. */
  before: z.unknown().optional(),
  /** Intended value — present on create/update. Optional; can be large. */
  after: z.unknown().optional(),
});
export type SyncChange = z.infer<typeof SyncChangeSchema>;

/**
 * A cell where the tenant diverged from baseline — the only thing a
 * consumer needs to decide whether to surface the conflict-resolution
 * affordance. Under `error` policy these BLOCK the push (they ride in
 * {@link SyncErrorSchema}); under `cms-wins` / `recipe-wins` they were
 * resolved and ride in {@link SyncResultSchema} as informational.
 */
export const SyncConflictCellSchema = z.object({
  path: z.string(),
  classification: z.enum(["cms-edit", "conflict"]),
});
export type SyncConflictCell = z.infer<typeof SyncConflictCellSchema>;

/** Mirror of `ResolvedIdentity` (sync/kind). Replaces `--identities-out`. */
export const ResolvedIdentitySchema = z.object({
  scope: z.enum(["brand-kit", "brief", "campaign", "deliverable", "task"]),
  handle: z.string().optional(),
  name: z.string().optional(),
  parentHandle: z.string().optional(),
  parentName: z.string().optional(),
  sitecoreId: z.string(),
});

/** The instance the operation targeted. Mirror of the public bits of `KindRef`. */
export const SyncRefSchema = z.object({
  id: z.string(),
  baselineKey: z.string().optional(),
  tenantId: z.string().optional(),
});

export const PlanSummarySchema = z.object({
  create: z.number().int().nonnegative(),
  update: z.number().int().nonnegative(),
  delete: z.number().int().nonnegative(),
  noop: z.number().int().nonnegative(),
});

/**
 * The typed `data` payload carried in a `ScaiEnvelope` under `--json` for
 * every sync push / pull / diff. This is what replaces stdout regexing.
 */
export const SyncResultSchema = z.object({
  contractVersion: z.literal(SYNC_CONTRACT_VERSION),
  operation: z.enum(["push", "pull", "diff"]),
  /** Recipe kind name — `brand-kit`, `brief`, `brief-type`, `campaign`. */
  kind: z.string(),
  ref: SyncRefSchema,
  mode: z.enum(["apply", "what-if"]),
  /** The plan (deletes already filtered unless `--prune`). */
  plan: z.array(SyncChangeSchema),
  summary: PlanSummarySchema,
  /** Count of changes written (0 under what-if / no-op). */
  applied: z.number().int().nonnegative(),
  /** Count of changes deliberately not written. */
  skipped: z.number().int().nonnegative(),
  /**
   * Resolved (under policy) tenant-edit cells — informational. Empty when
   * nothing diverged. Under `error` policy a divergence aborts instead,
   * so this list carries only resolved divergences.
   */
  conflicts: z.array(SyncConflictCellSchema),
  /** Resolved Sitecore UUIDs for everything scai touched. */
  identities: z.array(ResolvedIdentitySchema),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;

/**
 * The typed `data` payload scai emits under `--json` when a sync op
 * FAILS. A superset of the generic CLI error JSON (see `cli.ts`) with a
 * structured `conflicts[]` so a `POLICY_DENIED` three-way block is
 * machine-routable without parsing `details` strings.
 */
export const SyncErrorSchema = z.object({
  contractVersion: z.literal(SYNC_CONTRACT_VERSION),
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  details: z.array(z.string()).optional(),
  /** Present when `code === "POLICY_DENIED"` from a three-way merge block. */
  conflicts: z.array(SyncConflictCellSchema).optional(),
  remediation: z
    .object({
      actor: z.enum(["agent", "needs-human-terminal", "transient-retry"]),
      fix: z.string(),
      detail: z.string().optional(),
    })
    .optional(),
  exitCode: z.number().int(),
});
export type SyncError = z.infer<typeof SyncErrorSchema>;

/**
 * Stable feature tokens advertised by `scai capabilities`. The
 * orchestrator reads these ONCE at spawn and branches on the set,
 * replacing the scatter of `SCAI_HAS_*` env booleans. Add a token here
 * when you ship a capability the orchestrator needs to detect; never
 * remove one without a contract-version bump.
 */
export const SYNC_FEATURES = [
  /** push/pull/diff emit a {@link SyncResult} envelope under `--json`. */
  "json-sync-result",
  /** resolved identities ride in the envelope (no `--identities-out` file needed). */
  "identities-in-envelope",
  /** `scai capabilities` exists and answers this handshake. */
  "capabilities",
  /** `--conflict-policy` is accepted on push/pull. */
  "conflict-policy",
  /** structured `conflicts[]` on `POLICY_DENIED` errors. */
  "structured-conflicts",
  /** `scai ... pull --sitecore-id` id-first lookup (campaign + brief). */
  "campaign-pull-sitecore-id",
  /** `--lean` list projection (strays scan). */
  "list-lean",
] as const;
export type SyncFeature = (typeof SYNC_FEATURES)[number];

/**
 * Recipe kinds that participate in the typed sync contract. The
 * orchestrator reads this off the capability handshake to know which
 * kinds it can drive through the `--json` envelope.
 */
export const SYNC_CONTRACT_KINDS = ["brand-kit", "brief", "brief-type", "campaign"] as const;

/** Conflict policies the contract accepts, per direction. */
export const SYNC_CONFLICT_POLICIES = {
  push: ["error", "recipe-wins", "cms-wins"],
  pull: ["error", "recipe-wins", "tenant-wins"],
} as const;

/**
 * The capability handshake `scai capabilities --json` answers. The
 * orchestrator validates `contractVersion`, then gates behaviour on the
 * `features` set instead of probing flags via env.
 */
export const SyncCapabilitiesSchema = z.object({
  contractVersion: z.literal(SYNC_CONTRACT_VERSION),
  scaiVersion: z.string(),
  features: z.array(z.string()),
  kinds: z.array(z.string()),
  conflictPolicies: z.object({
    push: z.array(z.string()),
    pull: z.array(z.string()),
  }),
});
export type SyncCapabilities = z.infer<typeof SyncCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// Producer-side builders (scai only — consumers parse, they don't build).
// ---------------------------------------------------------------------------

/**
 * Pull the per-cell `classification` out of a `RecipeChange.meta` bag.
 * Kinds stamp it at `meta.classification` during `plan()`.
 */
const classificationOf = (
  meta: Record<string, unknown> | undefined
): SyncChange["classification"] => {
  const value = meta?.classification;
  return value === "first-push" ||
    value === "recipe-change" ||
    value === "cms-edit" ||
    value === "conflict"
    ? value
    : undefined;
};

/** Project a `RecipePlan` into the wire-stable `SyncChange[]`. */
const toSyncChanges = (plan: RecipePlan): SyncChange[] =>
  plan.changes.map((change) => {
    const classification = classificationOf(change.meta);
    return {
      kind: change.kind,
      path: change.path,
      summary: change.summary,
      ...(classification ? { classification } : {}),
      ...(change.before !== undefined ? { before: change.before } : {}),
      ...(change.after !== undefined ? { after: change.after } : {}),
    };
  });

/**
 * Resolved (non-blocking) tenant-edit cells, lifted from the plan. A cell
 * counts when its classification is `cms-edit` or `conflict` — under a
 * non-`error` policy those were resolved and applied, and the operator
 * should still SEE that a tenant edit was touched. (Under `error` policy
 * the kind throws before returning a plan, so these never reach here.)
 */
const conflictsFromPlan = (plan: RecipePlan): SyncConflictCell[] => {
  const cells: SyncConflictCell[] = [];
  for (const change of plan.changes) {
    const classification = classificationOf(change.meta);
    if (classification === "cms-edit" || classification === "conflict") {
      cells.push({ path: change.path, classification });
    }
  }
  return cells;
};

/**
 * Build a {@link SyncResult} from a `syncPush` outcome. The single place
 * scai's internal outcome shape becomes the wire contract — keep the
 * projection here so the command surfaces stay thin.
 */
export const buildSyncResult = (params: {
  operation: SyncResult["operation"];
  kind: string;
  ref: KindRef;
  mode: SyncMode;
  outcome: PushOutcome;
}): SyncResult => {
  const { operation, kind, ref, mode, outcome } = params;
  const summary = summarizePlan(outcome.plan);
  const identities: ResolvedIdentity[] = outcome.result?.identities ?? [];
  return {
    contractVersion: SYNC_CONTRACT_VERSION,
    operation,
    kind,
    ref: {
      id: ref.id,
      ...(ref.baselineKey ? { baselineKey: ref.baselineKey } : {}),
      ...(ref.tenantId ? { tenantId: ref.tenantId } : {}),
    },
    mode,
    plan: toSyncChanges(outcome.plan),
    summary,
    applied: outcome.result?.applied.length ?? 0,
    skipped: outcome.result?.skipped.length ?? 0,
    conflicts: conflictsFromPlan(outcome.plan),
    identities,
  };
};

/**
 * Build a {@link SyncResult} for a pure pull (`syncPull` returns a recipe,
 * not a plan). A pull writes the tenant state into the recipe side, so
 * there's no remote write to report — `plan` is empty and
 * `applied`/`skipped` are 0. Whether an instance was found on the tenant
 * is surfaced by the command via `envelope.meta.found`, keeping push and
 * pull `SyncResult` bodies symmetric.
 */
export const buildPullResult = (params: {
  kind: string;
  ref: KindRef;
  identities?: ResolvedIdentity[];
}): SyncResult => ({
  contractVersion: SYNC_CONTRACT_VERSION,
  operation: "pull",
  kind: params.kind,
  ref: {
    id: params.ref.id,
    ...(params.ref.baselineKey ? { baselineKey: params.ref.baselineKey } : {}),
    ...(params.ref.tenantId ? { tenantId: params.ref.tenantId } : {}),
  },
  mode: "apply",
  plan: [],
  summary: { create: 0, update: 0, delete: 0, noop: 0 },
  applied: 0,
  skipped: 0,
  conflicts: [],
  identities: params.identities ?? [],
});
