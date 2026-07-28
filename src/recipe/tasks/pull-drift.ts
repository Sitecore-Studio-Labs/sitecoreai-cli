import path from "node:path";
import { createScaiError } from "@/shared/errors";
import type { MergePlanRecipe } from "./pull-merge-plan";
import type { PerFieldStatuses } from "./pull-merge";

/**
 * Defensive: assert that a file path resolves inside a containing
 * directory. Belt-and-braces guard against path-traversal sinks where
 * an upstream identity-like string ends up in `path.join` — even if
 * the upstream validates the string, the guard catches a regression
 * before the bad write lands. Throws `INPUT_INVALID` on escape.
 *
 * Identity-time validation should still happen at the boundary
 * (`handleOf` validates `Scai Handle` against `HANDLE_PATTERN`) —
 * this is the second line of defence, not the first.
 */
export const assertWithinDir = (containerDir: string, candidatePath: string): void => {
  const resolvedContainer = path.resolve(containerDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const rel = path.relative(resolvedContainer, resolvedCandidate);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "..") {
    throw createScaiError(
      `Refusing to write outside the configured directory: ${candidatePath} (escape from ${containerDir}).`,
      "INPUT_INVALID",
      {
        hint: "The recipe handle or destination path resolved to a parent directory. Inspect tenant Scai Handle markers + outDir flag.",
      }
    );
  }
};

/**
 * Compare a plan entry's recorded per-field statuses against current
 * classifications. Returns the list of fields that drifted between
 * `write-plan` and `apply-plan` time — empty when the plan is still
 * fresh.
 *
 * Exported for unit-test coverage of the staleness path; runRecipePull
 * calls this inline + throws `INPUT_INVALID` when the result is non-
 * empty. Caller is responsible for the recipe-kind switch that decides
 * whether to compare against raw `fieldStatuses` or rolled-up
 * template statuses (templates use rolled-up; content kinds use raw).
 */
export const detectStalePlanDrift = (
  planEntry: MergePlanRecipe,
  currentStatuses: PerFieldStatuses
): string[] => {
  const drifted: string[] = [];
  for (const planField of planEntry.fields) {
    const current = currentStatuses.get(planField.rawKey.toLowerCase());
    if (current !== planField.status) {
      drifted.push(
        `${planField.field}: plan recorded ${planField.status}, current is ${current ?? "absent"}`
      );
    }
  }
  return drifted;
};
