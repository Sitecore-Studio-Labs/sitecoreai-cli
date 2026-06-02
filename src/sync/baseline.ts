/**
 * Kind-agnostic baseline storage — the "last-applied" leg of three-way
 * merge, shared across every recipe kind that opts in (content/page
 * recipes today; briefs + campaigns added alongside this seam).
 *
 * The content-recipe runtime carries its own file-backed
 * `FileBaselineStorage` in `src/recipe/runtime/baseline.ts`. That impl
 * predates this generic surface and stays in place — content callers
 * keep using it. New kinds (brief, campaign, …) use the interface
 * defined here, and the orchestrator plugs in a remote (DB-backed)
 * impl by implementing the same surface.
 *
 * Why kind-aware (a `kind` argument on every method): one backing
 * store typically serves multiple kinds. The file impl namespaces by
 * directory; a DB impl namespaces by column. Without the parameter
 * either every kind needs its own storage instance (defeating the
 * "single adapter" win) or callers smuggle the kind into the
 * `recipeHandle` string (ugly).
 *
 * The baseline payload is opaque to storage — each kind owns its
 * schema. The shared envelope (`Baseline<T>`) gives every kind the
 * same metadata (schemaVersion, captured-at, env, handle) for
 * forensics / replay. See docs/bidirectional-sync.md.
 */

/**
 * Per-field three-way classification, computed by the kind during
 * `plan()`. Recipes, briefs, and campaigns share the vocabulary even
 * though their "field" semantics differ.
 *
 *  - `first-push`     — no baseline entry for this field. Planner
 *                       can't classify; treat as a fresh write.
 *  - `recipe-change`  — tenant matches baseline, recipe diverges.
 *                       Safe `update` — author hasn't edited.
 *  - `cms-edit`       — tenant diverges from baseline, recipe matches
 *                       baseline. Author edited; under `cms-wins`
 *                       skip, under `recipe-wins` clobber, under
 *                       `error` block.
 *  - `conflict`       — both sides moved (tenant ≠ baseline ≠ recipe).
 *                       The dangerous state — same policy gates as
 *                       `cms-edit` but the operator should see it.
 */
export type FieldClassification = "first-push" | "recipe-change" | "cms-edit" | "conflict";

/**
 * Per-direction conflict policy. Push and pull share `"error"` and
 * each gets the side they protect: push has `cms-wins` (preserve the
 * tenant), pull has `tenant-wins` (preserve the recipe-on-disk).
 *
 * `"error"` is the safe default in scai's content-recipe runtime —
 * conflict surfaces, no silent clobber. For story sync (briefs +
 * campaigns) the orchestrator defaults to `cms-wins` on push /
 * `tenant-wins` on pull, since the registry is the recipe author and
 * Sitecore AI edits are the trusted source-of-truth for human-edited
 * fields. See plan-schema for that default.
 */
export type PushConflictPolicy = "error" | "recipe-wins" | "cms-wins";
export type PullConflictPolicy = "error" | "recipe-wins" | "tenant-wins";

/**
 * Envelope wrapped around every baseline document. Storage treats the
 * envelope opaquely — each kind owns its `payload` schema.
 *
 * `schemaVersion` is per-kind (the kind decides when to bump). The
 * envelope's outer version is `"1"` until the envelope shape itself
 * changes, which is rare.
 */
export interface Baseline<TPayload = unknown> {
  /** Outer envelope version. Bump when this shape changes. */
  envelopeVersion: "1";
  /** Which recipe kind authored this baseline (e.g. `"brief-instance"`). */
  kind: string;
  /** Recipe handle within the kind — stable identifier for the instance. */
  recipeHandle: string;
  /** Environment / tenant the baseline was captured against. */
  envName: string;
  /** ISO 8601 timestamp of the apply that produced this baseline. */
  capturedAt: string;
  /** Kind-specific payload (per-field hash map, etc.). */
  payload: TPayload;
}

/**
 * Stable canonical JSON for hashing — sorted object keys, no
 * whitespace. Two structurally equal values hash identical regardless
 * of key order. Used by every kind's baseline payload to hash field
 * values consistently. Exported so kind implementations don't each
 * re-derive their own canonicaliser.
 */
export const stableStringify = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
};

/**
 * SHA-256 hex of `stableStringify(value)` — the canonical baseline
 * hash. Identical inputs → identical hash regardless of key order or
 * whitespace; differing inputs → divergent hash with cryptographic
 * collision resistance. Shared across kinds so an orchestrator-side
 * DB-backed storage hashes the same value the kind hashes.
 */
export const hashJsonValue = (value: unknown): string => {
  // `createHash` is cheap; importing dynamically keeps the seam pure
  // (no Node-only baggage on every consumer of this module).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
};

/**
 * Three-way classify one cell from `(desired-hash, current-hash,
 * baseline-hash)`. `baseline-hash === undefined` means the kind never
 * pushed this cell before — `first-push`. The kind decides downstream
 * how to honour each classification under its push/pull policy.
 *
 *   R == B && C == B  → recipe-change (degenerate; equivalent to noop)
 *   R != B && C == B  → recipe-change (safe update)
 *   R == B && C != B  → cms-edit
 *   R != B && C != B  → conflict
 */
export const classifyHashes = (
  desiredHash: string,
  currentHash: string,
  baselineHash: string | undefined
): FieldClassification => {
  if (baselineHash === undefined) return "first-push";
  const recipeUnchanged = desiredHash === baselineHash;
  const tenantUnchanged = currentHash === baselineHash;
  if (recipeUnchanged && tenantUnchanged) return "recipe-change";
  if (!recipeUnchanged && tenantUnchanged) return "recipe-change";
  if (recipeUnchanged && !tenantUnchanged) return "cms-edit";
  return "conflict";
};

/**
 * Pluggable backing store for kind baselines. Storage is opaque to
 * payload schemas — each kind validates `Baseline.payload` itself on
 * `load`.
 *
 * Contract:
 *  - `load` returns `null` when no baseline exists yet for the
 *    `(kind, env, handle)` triple — meaning "first push", not "error".
 *    Throws only on integrity errors (malformed data, unreachable
 *    store). Treating malformed data as null would re-introduce the
 *    silent-clobber failure mode baselines exist to prevent.
 *  - `write` replaces the baseline wholesale (no merge).
 *  - `locator` returns a human-readable string for diagnostics —
 *    `"file:/path/to/baseline.json"` or
 *    `"postgres://brand_story_baselines/<key>"`. Never parsed.
 */
export interface BaselineStorage {
  load<TPayload = unknown>(
    kind: string,
    envName: string,
    recipeHandle: string
  ): Promise<Baseline<TPayload> | null>;
  write<TPayload = unknown>(
    kind: string,
    envName: string,
    recipeHandle: string,
    baseline: Baseline<TPayload>
  ): Promise<string>;
  locator(kind: string, envName: string, recipeHandle: string): string;
}
