/**
 * The cross-domain recipe aggregate — pull / diff / push every
 * enumerable recipe kind into one workspace directory.
 *
 * `syncPull`/`syncDiff`/`syncPush` in `./engine` each operate on ONE
 * instance of ONE kind. The aggregate fans them out across a set of
 * kinds and every instance each kind enumerates.
 *
 * Kind-agnostic: the caller supplies the kinds to cover, so this module
 * stays free of any concrete domain import (no cycle with `@/brand`,
 * `@/brief`, …). Only kinds that implement `RecipeKind.list` participate;
 * the rest are reported as skipped. Workspace layout is
 * `<dir>/<kind-name>/<slug(id)>.yaml`.
 *
 * Presentation-free: every function returns a structured result. The
 * caller (CLI command, MCP tool, embedding SDK consumer) decides how to
 * render it.
 */
import fs from "node:fs";
import path from "node:path";
import { toScaiError } from "@/shared/errors";
import { trimEdgeChar } from "@/shared/strings";
import { loadRecipe, writeRecipe } from "./io";
import { planIsNoop, summarizePlan, type PlanSummary } from "./plan";
import { syncDiff, syncPull, syncPush, type SyncMode } from "./engine";
import type { RecipeKind, SyncContext } from "./kind";

/** Default workspace directory for aggregate recipe files. */
export const DEFAULT_SYNC_DIR = ".scai/sync";

/** Slugify an instance id for a recipe filename. */
export const slugifyRecipeId = (value: string): string =>
  trimEdgeChar(value.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-") || "item";

/** Every recipe carries a `name` — its `KindRef.id`. */
const recipeId = (recipe: unknown): string => String((recipe as { name?: unknown }).name ?? "");

/** Recipe files under a kind's workspace subdirectory. */
const recipeFilesFor = (dir: string, kindName: string): string[] => {
  const kindDir = path.join(dir, kindName);
  if (!fs.existsSync(kindDir)) {
    return [];
  }
  return fs
    .readdirSync(kindDir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json"))
    .map((file) => path.join(kindDir, file));
};

// --- Pull ----------------------------------------------------------------

/** One recipe captured by `aggregatePull`. */
export interface AggregatePullItem {
  id: string;
  file: string;
}

/** Per-kind outcome of `aggregatePull`. */
export interface AggregatePullKind {
  kind: string;
  pulled: AggregatePullItem[];
  /** Set when the kind could not enumerate itself (e.g. no credential). */
  skipped?: string;
}

/** Structured result of `aggregatePull`. */
export interface AggregatePullResult {
  dir: string;
  kinds: AggregatePullKind[];
  total: number;
}

/**
 * Enumerate every instance of every enumerable kind and capture each as
 * a recipe file under `<dir>/<kind>/<slug>.yaml`. A kind that cannot
 * enumerate itself (no credential for this environment) is recorded as
 * `skipped` rather than failing the whole run.
 */
export const aggregatePull = async (
  kinds: ReadonlyArray<RecipeKind<unknown>>,
  ctx: SyncContext,
  options: { dir?: string } = {}
): Promise<AggregatePullResult> => {
  const dir = options.dir ?? DEFAULT_SYNC_DIR;
  const results: AggregatePullKind[] = [];
  let total = 0;

  for (const kind of kinds) {
    if (!kind.list) {
      continue;
    }
    let refs;
    try {
      refs = await kind.list(ctx);
    } catch (error) {
      results.push({ kind: kind.name, pulled: [], skipped: toScaiError(error).message });
      continue;
    }
    const pulled: AggregatePullItem[] = [];
    for (const ref of refs) {
      const recipe = await syncPull(kind, ref, ctx);
      if (!recipe) {
        continue;
      }
      const file = path.join(dir, kind.name, `${slugifyRecipeId(ref.id)}.yaml`);
      writeRecipe(file, recipe);
      pulled.push({ id: ref.id, file });
      total += 1;
    }
    results.push({ kind: kind.name, pulled });
  }

  return { dir, kinds: results, total };
};

// --- Status --------------------------------------------------------------

/** Drift classification of one recipe in `aggregateStatus`. */
export type AggregateDriftStatus = "in-sync" | "drift" | "error";

/** One recipe's drift status. */
export interface AggregateStatusItem {
  id: string;
  status: AggregateDriftStatus;
  /** Plan tally — present when `status` is `drift`. */
  summary?: PlanSummary;
  /** Failure message — present when `status` is `error`. */
  error?: string;
}

/** Per-kind outcome of `aggregateStatus`. */
export interface AggregateStatusKind {
  kind: string;
  items: AggregateStatusItem[];
}

/** Structured result of `aggregateStatus`. */
export interface AggregateStatusResult {
  dir: string;
  kinds: AggregateStatusKind[];
  /** Count of recipes that drifted from the environment. */
  drifted: number;
}

/**
 * Diff every recipe file in the workspace against the environment. A
 * kind with no workspace files is omitted from the result.
 */
export const aggregateStatus = async (
  kinds: ReadonlyArray<RecipeKind<unknown>>,
  ctx: SyncContext,
  options: { dir?: string } = {}
): Promise<AggregateStatusResult> => {
  const dir = options.dir ?? DEFAULT_SYNC_DIR;
  const results: AggregateStatusKind[] = [];
  let drifted = 0;

  for (const kind of kinds) {
    const files = recipeFilesFor(dir, kind.name);
    if (files.length === 0) {
      continue;
    }
    const items: AggregateStatusItem[] = [];
    for (const file of files) {
      const recipe = await loadRecipe(file, kind.schema);
      const id = recipeId(recipe);
      try {
        const plan = await syncDiff(kind, recipe, { kind: kind.name, id }, ctx);
        if (planIsNoop(plan)) {
          items.push({ id, status: "in-sync" });
        } else {
          items.push({ id, status: "drift", summary: summarizePlan(plan) });
          drifted += 1;
        }
      } catch (error) {
        items.push({ id, status: "error", error: toScaiError(error).message });
      }
    }
    results.push({ kind: kind.name, items });
  }

  return { dir, kinds: results, drifted };
};

// --- Push ----------------------------------------------------------------

/** Outcome of pushing one recipe in `aggregatePush`. */
export type AggregatePushStatus = "applied" | "in-sync" | "planned" | "error";

/** One recipe's push outcome. */
export interface AggregatePushItem {
  id: string;
  status: AggregatePushStatus;
  /** Changes written — present when `status` is `applied`. */
  appliedCount?: number;
  /** Changes that a non-dry-run would write — present when `status` is `planned`. */
  plannedCount?: number;
  /** Failure message — present when `status` is `error`. */
  error?: string;
}

/** Per-kind outcome of `aggregatePush`. */
export interface AggregatePushKind {
  kind: string;
  items: AggregatePushItem[];
}

/** Structured result of `aggregatePush`. */
export interface AggregatePushResult {
  dir: string;
  mode: SyncMode;
  kinds: AggregatePushKind[];
  /** Total changes written across every recipe (zero in `what-if` mode). */
  applied: number;
}

/**
 * Converge every recipe file in the workspace onto the environment. In
 * `what-if` mode nothing is written — each recipe reports its planned
 * change count instead. A kind with no workspace files is omitted.
 */
export const aggregatePush = async (
  kinds: ReadonlyArray<RecipeKind<unknown>>,
  ctx: SyncContext,
  options: { dir?: string; mode: SyncMode; prune?: boolean }
): Promise<AggregatePushResult> => {
  const dir = options.dir ?? DEFAULT_SYNC_DIR;
  const results: AggregatePushKind[] = [];
  let applied = 0;

  for (const kind of kinds) {
    const files = recipeFilesFor(dir, kind.name);
    if (files.length === 0) {
      continue;
    }
    const items: AggregatePushItem[] = [];
    for (const file of files) {
      const recipe = await loadRecipe(file, kind.schema);
      const id = recipeId(recipe);
      try {
        const outcome = await syncPush(kind, recipe, { kind: kind.name, id }, ctx, {
          mode: options.mode,
          prune: Boolean(options.prune),
        });
        if (outcome.result) {
          items.push({ id, status: "applied", appliedCount: outcome.result.applied.length });
          applied += outcome.result.applied.length;
        } else if (planIsNoop(outcome.plan)) {
          items.push({ id, status: "in-sync" });
        } else {
          const tally = summarizePlan(outcome.plan);
          items.push({
            id,
            status: "planned",
            plannedCount: tally.create + tally.update + tally.delete,
          });
        }
      } catch (error) {
        items.push({ id, status: "error", error: toScaiError(error).message });
      }
    }
    results.push({ kind: kind.name, items });
  }

  return { dir, mode: options.mode, kinds: results, applied };
};
