import { promises as fs } from "node:fs";
import { z } from "zod";
import { createScaiError } from "@/shared/errors";
import { humanizeFieldKey, type PerFieldStatuses, type RecipeMergeStatus } from "./pull-merge";

/**
 * Per-field winner pick for a recipe — operator's manual reconciliation
 * of a `tenant-edited` / `conflict` field. The `rawKey` is the internal
 * baselineLookupKey (`itemref|name:foo|lang|version`); `field` is the
 * human label rendered for display. `winner` is what the merge
 * synthesiser will pick for this field.
 *
 * `status` is the classification at plan-generation time; on apply the
 * pull re-classifies and verifies the status hasn't moved (a moved
 * classification means the tenant or disk changed between plan + apply,
 * and applying the stale plan could clobber a fresh edit — pull
 * refuses with a hint to regenerate).
 */
export const MergePlanFieldSchema = z.object({
  field: z.string(),
  rawKey: z.string(),
  status: z.enum(["in-sync", "disk-ahead", "tenant-edited", "conflict"]),
  winner: z.enum(["disk", "tenant"]),
});

export const MergePlanRecipeSchema = z.object({
  handle: z.string(),
  kind: z.string(),
  rollupStatus: z.enum([
    "in-sync",
    "disk-ahead",
    "tenant-edited",
    "conflict",
    "disk-only",
    "tenant-only",
  ]),
  fields: z.array(MergePlanFieldSchema),
});

/**
 * On-disk plan file emitted by `--write-plan` and consumed by
 * `--apply-plan`. Hand-editable JSON: operator opens the file, edits
 * per-(recipe, field) `winner` to `"disk"` or `"tenant"`, re-runs pull
 * with `--apply-plan <path>`. Pull rebuilds classifications + verifies
 * each entry's `status` still matches before applying — a drifted
 * classification means the world moved and applying the stale plan
 * could clobber a fresh edit.
 */
export const MergePlanSchema = z.object({
  schemaVersion: z.literal("1"),
  environment: z.string(),
  generatedAt: z.string(),
  /** The policy that pre-filled the winners. Display-only on apply. */
  policy: z.enum(["error", "disk-wins", "tenant-wins"]).optional(),
  recipes: z.array(MergePlanRecipeSchema),
});

export type MergePlan = z.infer<typeof MergePlanSchema>;
export type MergePlanRecipe = z.infer<typeof MergePlanRecipeSchema>;
export type MergePlanField = z.infer<typeof MergePlanFieldSchema>;

/**
 * Load + validate a merge plan from disk. Used by `--apply-plan`. Throws
 * `INPUT_INVALID` on missing file (the operator named a plan that
 * doesn't exist), malformed JSON, or schema violation.
 */
export const loadMergePlan = async (filePath: string): Promise<MergePlan> => {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      throw createScaiError(`Merge plan file not found: ${filePath}`, "INPUT_INVALID", {
        hint: "Run `recipe pull --write-plan <path>` first to generate the plan.",
      });
    }
    throw createScaiError(
      `Failed to read merge plan ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "INPUT_INVALID"
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createScaiError(
      `Invalid JSON in merge plan ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "INPUT_INVALID"
    );
  }
  const result = MergePlanSchema.safeParse(parsed);
  if (!result.success) {
    throw createScaiError(`Invalid merge plan at ${filePath}.`, "INPUT_INVALID", {
      hint: "Delete the file + re-run with --write-plan to regenerate.",
      details: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
      ),
    });
  }
  return result.data;
};

/**
 * Compose a `MergePlan` from per-recipe per-field statuses + the
 * current `--conflict-policy`. The plan pre-fills `winner` per the
 * policy: `disk` for `disk-ahead`, `tenant` for everything else under
 * `tenant-wins` and `error`; `disk` for `disk-ahead` AND `tenant-edited`
 * (preserve disk's view) and `tenant` for the rest under `disk-wins`.
 *
 * The plan is hand-editable; operator opens the file and flips
 * `winner` to override the policy for individual fields, then re-runs
 * `recipe pull --apply-plan <path>` to commit.
 */
export const composeMergePlan = (
  envName: string,
  policy: "error" | "disk-wins" | "tenant-wins",
  generatedAt: string,
  perRecipe: ReadonlyArray<{
    handle: string;
    kind: string;
    rollupStatus: RecipeMergeStatus;
    fieldStatuses: PerFieldStatuses;
    /**
     * Optional override for the humanised field label rendered into
     * the plan file. Used for template-style recipes where the rawKey
     * is a bare fieldRefKey (no `|name:...` segment) and
     * `humanizeFieldKey` would return an unrecognisable string.
     * Maps `rawKey.toLowerCase()` → human label (e.g., "Title (param)").
     */
    labels?: Map<string, string>;
  }>
): MergePlan => ({
  schemaVersion: "1",
  environment: envName,
  generatedAt,
  policy,
  recipes: perRecipe
    .filter((r) => r.fieldStatuses.size > 0)
    .map((r) => ({
      handle: r.handle,
      kind: r.kind,
      rollupStatus: r.rollupStatus,
      fields: [...r.fieldStatuses.entries()].map(([rawKey, status]) => {
        const defaultWinner: "disk" | "tenant" = (() => {
          if (policy === "disk-wins") {
            // Disk-wins preserves local view for any disk-side activity.
            return status === "in-sync" || status === "tenant-edited" ? "tenant" : "disk";
          }
          // tenant-wins + error policies: disk only wins when disk-ahead.
          return status === "disk-ahead" ? "disk" : "tenant";
        })();
        const label = r.labels?.get(rawKey.toLowerCase()) ?? humanizeFieldKey(rawKey);
        return {
          field: label,
          rawKey,
          status,
          winner: defaultWinner,
        };
      }),
    })),
});
