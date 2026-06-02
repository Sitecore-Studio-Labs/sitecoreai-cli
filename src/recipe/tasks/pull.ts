import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import { compileRecipeSet } from "../compile";
import { LAYOUT_FIELDS } from "../ir/sitecore-templates";
import { loadRecipe } from "../io";
import { readCurrentRecipes, type ReadCurrentRoots } from "../items/read-current";
import { collectBaselineEntries } from "../runtime/baseline-capture";
import { FileBaselineStorage } from "../runtime/baseline";
import type { OperationIr } from "../ir/operations";
import type {
  ComponentTemplateRecipe,
  ContentFieldValue,
  ContentItemRecipe,
  ContentTemplateRecipe,
  ContentTranslation,
  ContentVersion,
  FieldDefinition,
  Layout,
  PageRecipe,
  PageTemplateRecipe,
  Recipe,
} from "../schema/recipe";
import {
  recipeSetNeedsRoots,
  resolveRecipeInputs,
  resolveRecipeRoots,
  resolveTenant,
  toLogger,
  type RecipeTenantOptions,
} from "./shared";

/**
 * `scai provision recipe pull` — read tenant state and serialise every
 * reverse-projectable recipe to disk as `.recipe.json`.
 *
 * Two modes:
 *
 * ## Snapshot mode (default)
 *
 *   <outDir>/<kind>/<slug(handle)>.recipe.json
 *
 * Read-only against authored sources. Pull overwrites whatever's in
 * `<outDir>` but never touches the authored recipes directory. Useful
 * for backup / inspection / generating starter content.
 *
 * ## Merge mode (`--against <recipes-dir>`)
 *
 * Reads the authored recipes from `<recipes-dir>`, compiles both sides
 * (disk + tenant projection) through `compileRecipeSet`, hashes per
 * field via `collectBaselineEntries`, and classifies each recipe:
 *
 *   in-sync       disk + tenant agree (and match baseline if loaded)
 *   disk-ahead    disk has changes the tenant hasn't seen yet → push
 *   tenant-edited author edited tenant in the CMS since last push
 *   conflict      both sides moved since baseline → operator picks
 *   disk-only     recipe on disk, absent on tenant (deleted or never pushed)
 *   tenant-only   recipe on tenant, absent on disk (authored in CMS only)
 *
 * `--policy` governs the CLI exit code + per-recipe write:
 *   error (default) — exit non-zero if any `tenant-edited` or `conflict`
 *   disk-wins       — skip writes for recipes where the disk has changes;
 *                     pull only `in-sync` / `tenant-only` / `tenant-edited`
 *   tenant-wins     — always write tenant projection (operator accepts
 *                     adoption — still to outDir, never overwrites the
 *                     authored .recipe.ts source)
 *
 * The 10 reverse-projectable kinds (component-section, component-template,
 * content-template, page-template, enumeration, partial-design,
 * page-design, page, placeholder, content-item) round-trip; see
 * `read-current.ts` for the per-kind fidelity notes.
 */

/** Per-recipe merge classification (see runRecipePull JSDoc). */
export type RecipeMergeStatus =
  | "in-sync"
  | "disk-ahead"
  | "tenant-edited"
  | "conflict"
  | "disk-only"
  | "tenant-only";

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

export interface RecipePullOptions extends RecipeTenantOptions {
  /** Output directory for serialised tenant recipes. Defaults to `./pulled-recipes`. */
  output?: string;
  /**
   * Merge mode: path to the authored recipes directory (typically
   * `./recipes` or the glob resolved by `sitecoreai.cli.json`). When
   * unset (default), pull runs in snapshot mode — overwrites `<outDir>`
   * with no merge detection. When set, pull compares the tenant
   * projection against the disk recipes + baseline and classifies each
   * recipe per `RecipeMergeStatus`.
   *
   * Use `--against .` to pick up the default `recipes` glob from
   * `sitecoreai.cli.json` (resolveRecipeInputs reads the config).
   */
  against?: string;
  /**
   * Merge-mode conflict policy (only used when `--against` is set):
   *   - `"error"` (default) — exit non-zero on tenant-edited / conflict
   *   - `"disk-wins"`       — skip writes for recipes with disk changes
   *   - `"tenant-wins"`     — write every tenant projection regardless
   *
   * Mirrors push's `--conflict-policy` semantics, direction-inverted.
   */
  conflictPolicy?: "error" | "disk-wins" | "tenant-wins";
  /**
   * Skip three-way merge baseline loading. Without a baseline the
   * planner falls back to two-way diff (any divergence reads as
   * `conflict` since we can't tell who moved). Mirrors push's
   * `--no-baseline`.
   */
  noBaseline?: boolean;
  /**
   * Path to write a merge-plan JSON file. Plan is a hand-editable
   * snapshot of every per-recipe per-field classification + the
   * pre-filled winner pick per the current `--conflict-policy`.
   * Operator edits the `winner` entries then re-runs pull with
   * `--apply-plan <same-path>` to commit their picks. Implies merge
   * mode (`--against` must be set). Doesn't write the synthesised
   * recipes — that's `--apply-plan`'s job.
   */
  writePlan?: string;
  /**
   * Path to read a merge-plan JSON file from. Pull rebuilds
   * classifications fresh, verifies each plan entry's status still
   * matches the current tenant + disk state, then synthesises merged
   * recipes using the plan's `winner` picks per field. Refuses to apply
   * if the env doesn't match, any plan entry's classification has
   * drifted, or the plan references recipes the current set doesn't
   * have — the operator must regenerate.
   */
  applyPlan?: string;
  /**
   * Test-only injection for the plan's `generatedAt` timestamp. When
   * unset, the writer stamps `new Date().toISOString()`. Tests pin a
   * value so the plan output is byte-stable.
   */
  now?: string;
  /**
   * Dry-run: classify + report what WOULD be written, but skip every
   * file write (recipe JSON files, merge plan, baseline reads still
   * happen). Useful in CI for verifying tenant + disk are in sync
   * without leaving any artifacts on the runner FS. Result still
   * carries `files` entries with `path: null` for entries that would
   * have been written.
   */
  dryRun?: boolean;
  /** Override `templatesRoot` from the env profile. */
  templatesRoot?: string;
  /** Override `renderingsRoot` from the env profile. */
  renderingsRoot?: string;
  /** Override `componentsRoot` from the env profile. */
  componentsRoot?: string;
  /** Override `contentModelsRoot` from the env profile. */
  contentModelsRoot?: string;
  /** Override `pageTemplatesRoot` from the env profile. */
  pageTemplatesRoot?: string;
  /** Override `partialDesignsRoot` from the env profile. */
  partialDesignsRoot?: string;
  /** Override `pageDesignsRoot` from the env profile. */
  pageDesignsRoot?: string;
  /** Override `pagesRoot` from the env profile. */
  pagesRoot?: string;
  /** Override `enumerationsRoot` from the env profile. */
  enumerationsRoot?: string;
  /** Override `placeholderSettingsRoot` from the env profile. */
  placeholderSettingsRoot?: string;
  /** Override `contentItemsRoot` from the env profile. */
  contentItemsRoot?: string;
}

/** Per-recipe outcome — file written (if any) + merge status. */
export interface RecipePullEntry {
  handle: string;
  kind: string;
  /** Filesystem path of the written `.recipe.json`. `null` when skipped. */
  path: string | null;
  /** Merge classification. `"in-sync"` is also used in snapshot mode for every recipe. */
  status: RecipeMergeStatus;
  /**
   * Number of fields whose hash changed on each side relative to the
   * baseline. Only populated in merge mode; both `0` outside it.
   */
  diskChangedFields?: number;
  tenantChangedFields?: number;
  /**
   * Per-field classifications keyed by humanised label
   * (`fieldName (lang, v#)` or `fieldName` for shared fields). Surfaced
   * so JSON consumers + verbose human output can inspect WHICH fields
   * moved on which side. Only populated in merge mode.
   */
  fieldStatuses?: Array<{ key: string; status: FieldMergeStatus }>;
}

export interface RecipePullResult {
  outputDir: string;
  totalRecipes: number;
  byKind: Record<string, number>;
  byStatus: Record<RecipeMergeStatus, number>;
  files: RecipePullEntry[];
  /**
   * True when the operator passed `--against` AND `--policy=error` AND
   * any recipe classified as `tenant-edited` or `conflict`. The CLI
   * layer surfaces this as exit non-zero.
   */
  blocked: boolean;
}

const slugifyHandle = (handle: string): string => handle.replace(/@/g, "_v");

const resolveRoots = (
  options: RecipePullOptions,
  environment: {
    templatesRoot?: string;
    renderingsRoot?: string;
    componentsRoot?: string;
    contentModelsRoot?: string;
    pageTemplatesRoot?: string;
    partialDesignsRoot?: string;
    pageDesignsRoot?: string;
    pagesRoot?: string;
    enumerationsRoot?: string;
    placeholderSettingsRoot?: string;
    contentItemsRoot?: string;
  }
): ReadCurrentRoots => ({
  templatesRoot: options.templatesRoot ?? environment.templatesRoot ?? "",
  renderingsRoot: options.renderingsRoot ?? environment.renderingsRoot ?? "",
  ...(options.componentsRoot !== undefined || environment.componentsRoot !== undefined
    ? { componentsRoot: options.componentsRoot ?? environment.componentsRoot }
    : {}),
  ...(options.contentModelsRoot !== undefined || environment.contentModelsRoot !== undefined
    ? { contentModelsRoot: options.contentModelsRoot ?? environment.contentModelsRoot }
    : {}),
  ...(options.pageTemplatesRoot !== undefined || environment.pageTemplatesRoot !== undefined
    ? { pageTemplatesRoot: options.pageTemplatesRoot ?? environment.pageTemplatesRoot }
    : {}),
  ...(options.partialDesignsRoot !== undefined || environment.partialDesignsRoot !== undefined
    ? { partialDesignsRoot: options.partialDesignsRoot ?? environment.partialDesignsRoot }
    : {}),
  ...(options.pageDesignsRoot !== undefined || environment.pageDesignsRoot !== undefined
    ? { pageDesignsRoot: options.pageDesignsRoot ?? environment.pageDesignsRoot }
    : {}),
  ...(options.pagesRoot !== undefined || environment.pagesRoot !== undefined
    ? { pagesRoot: options.pagesRoot ?? environment.pagesRoot }
    : {}),
  ...(options.enumerationsRoot !== undefined || environment.enumerationsRoot !== undefined
    ? { enumerationsRoot: options.enumerationsRoot ?? environment.enumerationsRoot }
    : {}),
  ...(options.placeholderSettingsRoot !== undefined ||
  environment.placeholderSettingsRoot !== undefined
    ? {
        placeholderSettingsRoot:
          options.placeholderSettingsRoot ?? environment.placeholderSettingsRoot,
      }
    : {}),
  ...(options.contentItemsRoot !== undefined || environment.contentItemsRoot !== undefined
    ? { contentItemsRoot: options.contentItemsRoot ?? environment.contentItemsRoot }
    : {}),
});

/**
 * Classify one recipe's merge state from per-(itemRefKey, fieldKey)
 * hash maps for disk vs tenant vs baseline. Direction-inverted from
 * push's drift classification:
 *   - disk == baseline + tenant != baseline   → `tenant-edited`
 *   - disk != baseline + tenant == baseline   → `disk-ahead`
 *   - both diverged, disk != tenant            → `conflict`
 *   - one side missing entirely                → `disk-only` / `tenant-only`
 *   - everything equal                         → `in-sync`
 */
export const classifyMergeStatus = (
  diskHashes: Map<string, string> | null,
  tenantHashes: Map<string, string> | null,
  baselineHashes: Map<string, string> | null
): { status: RecipeMergeStatus; diskChanged: number; tenantChanged: number } => {
  if (diskHashes === null && tenantHashes === null) {
    return { status: "in-sync", diskChanged: 0, tenantChanged: 0 };
  }
  if (diskHashes === null) {
    return { status: "tenant-only", diskChanged: 0, tenantChanged: 0 };
  }
  if (tenantHashes === null) {
    return { status: "disk-only", diskChanged: 0, tenantChanged: 0 };
  }
  // Union of field keys across both sides.
  const allKeys = new Set<string>([...diskHashes.keys(), ...tenantHashes.keys()]);
  let diskChanged = 0;
  let tenantChanged = 0;
  let anyDiff = false;
  let anyConflict = false;
  for (const key of allKeys) {
    const d = diskHashes.get(key);
    const t = tenantHashes.get(key);
    const b = baselineHashes?.get(key);
    if (d === t) continue;
    anyDiff = true;
    if (b !== undefined) {
      if (d !== b) diskChanged += 1;
      if (t !== b) tenantChanged += 1;
      if (d !== b && t !== b) anyConflict = true;
    } else {
      // No baseline coverage for this field. Mirror perFieldStatuses'
      // first-pull-friendly classification (audit R4):
      //   - field only on disk → disk-ahead (local addition)
      //   - field only on tenant → tenant-edited (CMS addition)
      //   - both sides have it but differ → conflict (can't tell who moved)
      if (d === undefined) tenantChanged += 1;
      else if (t === undefined) diskChanged += 1;
      else {
        diskChanged += 1;
        tenantChanged += 1;
        anyConflict = true;
      }
    }
  }
  if (!anyDiff) return { status: "in-sync", diskChanged: 0, tenantChanged: 0 };
  if (anyConflict) return { status: "conflict", diskChanged, tenantChanged };
  if (diskChanged > 0 && tenantChanged === 0) {
    return { status: "disk-ahead", diskChanged, tenantChanged };
  }
  if (tenantChanged > 0 && diskChanged === 0) {
    return { status: "tenant-edited", diskChanged, tenantChanged };
  }
  // Both diverged from baseline (matching each other coincidentally is
  // covered by the d===t short-circuit above). Treat as conflict.
  return { status: "conflict", diskChanged, tenantChanged };
};

/**
 * Build a `(itemRefKey, fieldKey) → hash` map from a list of baseline
 * entries — the wire form `collectBaselineEntries` produces from any IR.
 * Mirrors `baseline.ts`'s `baselineLookupKey` so disk + tenant + baseline
 * indexes share keys.
 */
const indexHashes = (
  entries: ReadonlyArray<{
    itemRefKey: string;
    fieldId: string;
    fieldName?: string;
    language?: string;
    version?: number;
    valueHash: string;
  }>
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const e of entries) {
    const idPart =
      e.fieldName !== undefined
        ? `name:${e.fieldName.toLowerCase()}`
        : `id:${e.fieldId.toLowerCase()}`;
    const key = `${e.itemRefKey.toLowerCase()}|${idPart}|${e.language ?? ""}|${e.version ?? ""}`;
    out.set(key, e.valueHash);
  }
  return out;
};

/** One per-field classification — same domain as the per-recipe rollup. */
export type FieldMergeStatus = "in-sync" | "disk-ahead" | "tenant-edited" | "conflict";

/**
 * Convert an internal baselineLookupKey (`itemref|name:foo|lang|version`)
 * to a human-readable label for CLI output. Drops the itemRefKey segment
 * (always the same per recipe) and renders `(lang, v#)` only when set.
 */
const humanizeFieldKey = (key: string): string => {
  const parts = key.split("|");
  if (parts.length < 4) return key;
  const idPart = parts[1] ?? "";
  const lang = parts[2] ?? "";
  const version = parts[3] ?? "";
  const name = idPart.startsWith("name:") ? idPart.slice(5) : idPart;
  if (!lang && !version) return name;
  return `${name} (${lang || "-"}${version ? `, v${version}` : ""})`;
};

/**
 * Per-field classification map. Same key shape as `indexHashes` — encodes
 * `(itemRefKey, fieldName|fieldId, language, version)` so a Recipe-side
 * field name can be hashed back to a status lookup.
 */
export type PerFieldStatuses = Map<string, FieldMergeStatus>;

/**
 * Per-field three-way classification — fans the per-(itemRefKey, fieldKey)
 * decision out so the caller can act per-field (e.g. synthesise a merged
 * Recipe under `tenant-wins` that preserves `disk-ahead` fields).
 *
 *   disk == tenant                        → in-sync
 *   disk != tenant && tenant == baseline  → disk-ahead
 *   disk != tenant && disk == baseline    → tenant-edited
 *   both != baseline (or no baseline)     → conflict
 */
export const perFieldStatuses = (
  diskHashes: Map<string, string> | null,
  tenantHashes: Map<string, string> | null,
  baselineHashes: Map<string, string> | null
): PerFieldStatuses => {
  const out: PerFieldStatuses = new Map();
  const allKeys = new Set<string>([...(diskHashes?.keys() ?? []), ...(tenantHashes?.keys() ?? [])]);
  for (const key of allKeys) {
    const d = diskHashes?.get(key);
    const t = tenantHashes?.get(key);
    const b = baselineHashes?.get(key);
    if (d === t && d !== undefined) {
      out.set(key, "in-sync");
      continue;
    }
    if (b !== undefined) {
      const diskMoved = d !== b;
      const tenantMoved = t !== b;
      if (diskMoved && tenantMoved) out.set(key, "conflict");
      else if (diskMoved) out.set(key, "disk-ahead");
      else out.set(key, "tenant-edited");
    } else {
      // No baseline coverage for this field. Three sub-cases:
      //   - field only on disk → most likely a local addition the
      //     operator hasn't pushed yet → "disk-ahead"
      //   - field only on tenant → most likely a CMS-authored addition
      //     → "tenant-edited"
      //   - both sides have it but differ → genuinely ambiguous (we
      //     can't tell who moved without a baseline) → "conflict"
      //
      // The first two cases used to bucket as "conflict" which produced
      // a wall of conflicts on the first pull against a tenant with no
      // baseline files yet — `--policy=error` would block by default,
      // forcing the operator into `--no-baseline` or `--policy=tenant-wins`
      // to get any output. The narrower classification matches the
      // operator's mental model: "field present on only one side" is
      // an addition, not a conflict.
      if (d === undefined) out.set(key, "tenant-edited");
      else if (t === undefined) out.set(key, "disk-ahead");
      else out.set(key, "conflict");
    }
  }
  return out;
};

/**
 * Roll up per-field statuses into a single per-recipe status. Mirrors
 * the legacy `classifyMergeStatus` behaviour for the per-recipe summary
 * (now derived from the same per-field map so the two views stay
 * consistent).
 */
const rollupPerFieldStatuses = (
  statuses: PerFieldStatuses
): { status: RecipeMergeStatus; diskChanged: number; tenantChanged: number } => {
  let diskChanged = 0;
  let tenantChanged = 0;
  let anyConflict = false;
  let anyDiff = false;
  for (const s of statuses.values()) {
    if (s === "in-sync") continue;
    anyDiff = true;
    if (s === "conflict") {
      anyConflict = true;
      diskChanged += 1;
      tenantChanged += 1;
    } else if (s === "disk-ahead") {
      diskChanged += 1;
    } else if (s === "tenant-edited") {
      tenantChanged += 1;
    }
  }
  if (!anyDiff) return { status: "in-sync", diskChanged: 0, tenantChanged: 0 };
  if (anyConflict) return { status: "conflict", diskChanged, tenantChanged };
  if (diskChanged > 0 && tenantChanged === 0)
    return { status: "disk-ahead", diskChanged, tenantChanged };
  if (tenantChanged > 0 && diskChanged === 0)
    return { status: "tenant-edited", diskChanged, tenantChanged };
  return { status: "conflict", diskChanged, tenantChanged };
};

/**
 * The label every CreateItem op for the main content-item / page item
 * carries — produced by `compileContentItemRecipe` (`content-item:<handle>`)
 * and `compilePageRecipe` (`page:<handle>`). Used to recover the IR's
 * `itemRefKey` for the main item without re-computing site-aware GUIDs
 * here — the IR already has the canonical value.
 */
const findMainItemRefKey = (ir: OperationIr, kind: "content-item" | "page"): string | undefined => {
  const label = `${kind}:${ir.recipeHandle}`;
  for (const op of ir.operations) {
    if (op.op === "CreateItem" && op.label === label) return op.id;
  }
  return undefined;
};

/** Same baselineLookupKey shape as baseline.ts / indexHashes. */
const fieldKey = (
  itemRefKey: string,
  fieldName: string,
  language?: string,
  version?: number
): string =>
  `${itemRefKey.toLowerCase()}|name:${fieldName.toLowerCase()}|${language ?? ""}|${version ?? ""}`;

/**
 * Per-field merge for content-value-bearing recipes (ContentItem, Page).
 * Under `tenant-wins`:
 *   - `disk-ahead` fields (local change unique to disk) → KEEP disk value
 *   - all other statuses → take tenant value
 * Fields present on only one side adopt that side's value verbatim.
 *
 * The base structure (handle, name, displayName, description, template,
 * workflow) comes from tenant — those aren't per-field tracked.
 *
 * Layout is per-(language, version) merged like other fields: the
 * baseline hash for `__Renderings` / `__Final Renderings` is computed
 * against the canonicalised XML form (`canonicaliseLayoutXml` in
 * baseline.ts, which parses through `parseLayoutXml` then serialises
 * to deterministic JSON), so the same logical layout hashes identical
 * regardless of canonical-vs-SXA-delta wire form. `layoutWinner`
 * inside this merge picks disk over tenant when the per-(lang, version)
 * cell is `disk-ahead`, else tenant. Applies to:
 *   - per-version layouts on both ContentItem + Page (`versions[][n].layout`)
 *   - Page item-level `recipe.layout` (simple mode) via the
 *     (DEFAULT_LANGUAGE, DEFAULT_VERSION) cell
 *
 * The function returns the tenantRecipe unchanged when `mainItemRefKey`
 * couldn't be located (defensive: a degenerate IR with no main
 * CreateItem op shouldn't crash the pull).
 */
export const mergeContentValueRecipe = (
  diskRecipe: ContentItemRecipe | PageRecipe,
  tenantRecipe: ContentItemRecipe | PageRecipe,
  statuses: PerFieldStatuses,
  mainItemRefKey: string | undefined,
  /**
   * Optional per-(rawKey) override for the winner decision. Operator-set
   * via the merge-plan file (`--apply-plan`). When a key is present in
   * the overrides map, its value is used directly; missing keys fall
   * through to the default `disk-ahead → disk, else → tenant` policy.
   */
  winnerOverrides?: Map<string, "disk" | "tenant">
): ContentItemRecipe | PageRecipe => {
  if (mainItemRefKey === undefined) return tenantRecipe;

  /** Decide which side wins for one (fieldName, lang?, version?) cell. */
  const winner = (fieldName: string, language?: string, version?: number): "disk" | "tenant" => {
    const key = fieldKey(mainItemRefKey, fieldName, language, version);
    const override = winnerOverrides?.get(key);
    if (override !== undefined) return override;
    const status = statuses.get(key);
    // Only `disk-ahead` preserves the disk value. Everything else
    // (in-sync, tenant-edited, conflict, undefined) yields to tenant.
    return status === "disk-ahead" ? "disk" : "tenant";
  };

  /**
   * Layout cells use the `__Final Renderings` field GUID (no fieldName)
   * in the IR — `baselineLookupKey` keys them by `id:<guid>` rather than
   * `name:<field>`. Build the key shape directly so we can look up the
   * per-(lang, version) layout status. Picks `disk` only when the cell
   * is `disk-ahead`; everything else yields to tenant's layout. Honours
   * the merge-plan override too when set.
   */
  const layoutWinner = (language: string, version: number): "disk" | "tenant" => {
    const key = `${mainItemRefKey.toLowerCase()}|id:${LAYOUT_FIELDS.FINAL_RENDERINGS.toLowerCase()}|${language}|${version}`;
    const override = winnerOverrides?.get(key);
    if (override !== undefined) return override;
    const status = statuses.get(key);
    return status === "disk-ahead" ? "disk" : "tenant";
  };

  const mergeFieldMap = (
    diskFields: Record<string, ContentFieldValue> | undefined,
    tenantFields: Record<string, ContentFieldValue> | undefined,
    language?: string,
    version?: number
  ): Record<string, ContentFieldValue> => {
    const out: Record<string, ContentFieldValue> = {};
    const allNames = new Set<string>([
      ...Object.keys(diskFields ?? {}),
      ...Object.keys(tenantFields ?? {}),
    ]);
    for (const name of allNames) {
      const lookupKey = fieldKey(mainItemRefKey, name, language, version);
      const choose = winner(name, language, version);
      const explicit = winnerOverrides?.has(lookupKey) ?? false;
      // Explicit operator override (from --apply-plan): honour strictly,
      // no fallback to the other side. This is what lets the operator
      // accept a tenant-side deletion — pick `tenant` for a disk-only
      // field and the field is omitted entirely. Without an override,
      // fall back to whichever side has the value (preserve data: a
      // disk-only field is most likely a local addition the operator
      // hasn't pushed yet, not a deletion they wanted to ratify).
      const value = explicit
        ? choose === "disk"
          ? diskFields?.[name]
          : tenantFields?.[name]
        : choose === "disk"
          ? (diskFields?.[name] ?? tenantFields?.[name])
          : (tenantFields?.[name] ?? diskFields?.[name]);
      if (value !== undefined) out[name] = value;
    }
    return out;
  };

  // Start with the tenant projection as the base — operator opted into
  // tenant-wins. Overlay disk-ahead field values per cell below.
  // Cast to the union for assignment safety; per-field merge preserves
  // the discriminator (`kind`).
  const merged = { ...tenantRecipe } as ContentItemRecipe | PageRecipe;

  // Simple-mode default-language fields (DEFAULT_LANGUAGE = "en",
  // DEFAULT_VERSION = 1). compileContentItemRecipe / compilePageRecipe
  // emit these at (en, 1), so we look up per-field statuses at the
  // same coordinates.
  const DEFAULT_LANGUAGE = "en";
  const DEFAULT_VERSION = 1;
  merged.fields = mergeFieldMap(
    diskRecipe.fields,
    tenantRecipe.fields,
    DEFAULT_LANGUAGE,
    DEFAULT_VERSION
  );

  // Shared bucket (storage:shared template fields) — no language/version
  // on the IR side.
  if (diskRecipe.shared !== undefined || tenantRecipe.shared !== undefined) {
    const mergedShared = mergeFieldMap(diskRecipe.shared, tenantRecipe.shared);
    if (Object.keys(mergedShared).length > 0) merged.shared = mergedShared;
    else delete merged.shared;
  }

  // Translations — per language, version stays at 1 in simple mode.
  if (diskRecipe.translations !== undefined || tenantRecipe.translations !== undefined) {
    const mergedTranslations: Record<string, ContentTranslation> = {};
    const allLangs = new Set<string>([
      ...Object.keys(diskRecipe.translations ?? {}),
      ...Object.keys(tenantRecipe.translations ?? {}),
    ]);
    for (const lang of allLangs) {
      const dFields = diskRecipe.translations?.[lang]?.fields;
      const tFields = tenantRecipe.translations?.[lang]?.fields;
      mergedTranslations[lang] = { fields: mergeFieldMap(dFields, tFields, lang, DEFAULT_VERSION) };
    }
    merged.translations = mergedTranslations;
  }

  // Story-mode versions — per (language, numbered version). Merge the
  // version-stack union; for versions present on both sides, do per-field
  // merge inside the entry. For versions present on only one side, keep
  // that side's entry verbatim.
  if (diskRecipe.versions !== undefined || tenantRecipe.versions !== undefined) {
    const mergedVersions: Record<string, ContentVersion[]> = {};
    const allLangs = new Set<string>([
      ...Object.keys(diskRecipe.versions ?? {}),
      ...Object.keys(tenantRecipe.versions ?? {}),
    ]);
    for (const lang of allLangs) {
      const diskEntries = diskRecipe.versions?.[lang] ?? [];
      const tenantEntries = tenantRecipe.versions?.[lang] ?? [];
      const allVersionNumbers = new Set<number>([
        ...diskEntries.map((e) => e.version),
        ...tenantEntries.map((e) => e.version),
      ]);
      const sorted = [...allVersionNumbers].sort((a, b) => a - b);
      mergedVersions[lang] = sorted.map((versionN) => {
        const dEntry = diskEntries.find((e) => e.version === versionN);
        const tEntry = tenantEntries.find((e) => e.version === versionN);
        // Base preserves per-version metadata (workflowState, date)
        // from the tenant when present; falls back to disk only when
        // the tenant lacks the version (disk-only at the version level).
        const base = tEntry ?? dEntry!;
        const merged: ContentVersion = {
          ...base,
          fields: mergeFieldMap(dEntry?.fields, tEntry?.fields, lang, versionN),
        };
        // Layout merge: classify the per-(lang, version) `__Final
        // Renderings` cell via the canonical-XML baseline hash, and
        // pick the disk-side layout only when it's `disk-ahead`. Both
        // sides may carry a layout — when neither does, the field is
        // omitted entirely.
        const diskLayout = dEntry?.layout;
        const tenantLayout = tEntry?.layout;
        if (diskLayout !== undefined || tenantLayout !== undefined) {
          const choose = layoutWinner(lang, versionN);
          const layout =
            choose === "disk" ? (diskLayout ?? tenantLayout) : (tenantLayout ?? diskLayout);
          if (layout !== undefined) merged.layout = layout;
          else delete merged.layout;
        }
        return merged;
      });
    }
    merged.versions = mergedVersions;
  }

  // Page item-level layout (simple mode) — the compiler writes the same
  // layout to every populated (lang, 1) cell, so checking the primary
  // (DEFAULT_LANGUAGE, DEFAULT_VERSION) cell is representative. Only
  // applies to PageRecipe; ContentItemRecipe doesn't carry an
  // item-level layout.
  if (diskRecipe.kind === "page" && tenantRecipe.kind === "page") {
    const diskPage = diskRecipe as PageRecipe;
    const tenantPage = tenantRecipe as PageRecipe;
    const diskLayout: Layout | undefined = diskPage.layout;
    const tenantLayout: Layout | undefined = tenantPage.layout;
    if (diskLayout !== undefined || tenantLayout !== undefined) {
      const choose = layoutWinner(DEFAULT_LANGUAGE, DEFAULT_VERSION);
      const mergedPage = merged as PageRecipe;
      const layout =
        choose === "disk" ? (diskLayout ?? tenantLayout) : (tenantLayout ?? diskLayout);
      if (layout !== undefined) mergedPage.layout = layout;
      else delete mergedPage.layout;
    }
  }

  return merged;
};

/**
 * Walk an IR for a template-style recipe (ComponentTemplate /
 * ContentTemplate / PageTemplate / DesignParametersTemplate) and build
 * a `(fieldName → fieldRefKey)` map per field kind. Used by the
 * template-merge so we can look up a field's refKey from its name on
 * the recipe surface, without re-doing the site-aware `fieldId(…)`
 * derivation.
 *
 * Reads the canonical labels emitted by `shared.ts`'s field-emitter:
 *   - `field:<handle>/<fieldName>`        — main template fields
 *   - `params-field:<handle>/<fieldName>` — params-template fields
 *
 * Returns `{ fields, params }` maps; either may be empty when the IR
 * doesn't emit that field kind (a content-template has no params).
 */
const templateFieldRefKeyIndex = (
  ir: OperationIr
): { fields: Map<string, string>; params: Map<string, string> } => {
  const fields = new Map<string, string>();
  const params = new Map<string, string>();
  const fieldLabel = `field:${ir.recipeHandle}/`;
  const paramsLabel = `params-field:${ir.recipeHandle}/`;
  for (const op of ir.operations) {
    if (op.op !== "CreateItem") continue;
    if (op.label.startsWith(paramsLabel)) {
      const name = op.label.slice(paramsLabel.length);
      params.set(name.toLowerCase(), op.id);
    } else if (op.label.startsWith(fieldLabel)) {
      const name = op.label.slice(fieldLabel.length);
      fields.set(name.toLowerCase(), op.id);
    }
  }
  return { fields, params };
};

/**
 * Roll up a single template-field's per-property statuses to a
 * field-level verdict. A template field's IR emits multiple SetField
 * ops (Type, Source, Title, SortOrder, Shared, etc.) — each has its
 * own classification. The field-level rollup mirrors the recipe-level
 * rollup logic in `rollupPerFieldStatuses`:
 *
 *   - no per-property entries          → undefined (no signal)
 *   - all in-sync                      → in-sync
 *   - any conflict, or
 *     disk-ahead + tenant-edited        → conflict
 *   - only disk-ahead                  → disk-ahead
 *   - only tenant-edited               → tenant-edited
 */
/**
 * Pre-group per-property statuses by their owning `<refKey>` prefix.
 * Mirrors the prefix-extraction the old `templateFieldRollup`
 * `startsWith` did inline, but only walks the statuses map ONCE up
 * front. Per-field rollups then become an O(properties-per-field)
 * lookup — collapses an O(T × S) loop (T fields × S total statuses)
 * to O(S) once + O(P) per field.
 */
const groupStatusesByOwnerRefKey = (
  statuses: PerFieldStatuses
): Map<string, FieldMergeStatus[]> => {
  const out = new Map<string, FieldMergeStatus[]>();
  for (const [key, status] of statuses) {
    const pipeIdx = key.indexOf("|");
    // Keys without `|` (bare refKey, e.g. when caller already rolled
    // up) group as themselves so the same lookup works for both shapes.
    const owner = pipeIdx > 0 ? key.slice(0, pipeIdx) : key;
    let arr = out.get(owner);
    if (!arr) {
      arr = [];
      out.set(owner, arr);
    }
    arr.push(status);
  }
  return out;
};

const templateFieldRollup = (
  fieldRefKey: string,
  groupedStatuses: Map<string, FieldMergeStatus[]>
): FieldMergeStatus | undefined => {
  const matching = groupedStatuses.get(fieldRefKey.toLowerCase());
  if (!matching || matching.length === 0) return undefined;
  let inSync = false;
  let diskAhead = false;
  let tenantEdited = false;
  let conflict = false;
  for (const status of matching) {
    if (status === "in-sync") inSync = true;
    else if (status === "disk-ahead") diskAhead = true;
    else if (status === "tenant-edited") tenantEdited = true;
    else conflict = true;
  }
  if (conflict) return "conflict";
  if (diskAhead && tenantEdited) return "conflict";
  if (diskAhead) return "disk-ahead";
  if (tenantEdited) return "tenant-edited";
  if (inSync) return "in-sync";
  return undefined;
};

/**
 * Per-field merge for template-style recipes (ComponentTemplate,
 * ContentTemplate, PageTemplate). Matches `recipe.fields[]` (and
 * `recipe.params[]` for ComponentTemplate) by field NAME — names are
 * the stable identity that survives reordering. Per-field rollup picks
 * the winning side at the FieldDefinition level (not per-property);
 * disk-ahead fields preserve their disk definitions, everything else
 * (in-sync, tenant-edited, conflict, no-data) yields to tenant.
 *
 * Limitations (documented in code):
 *  - Renames are detected as delete + create (old name → tenant-only,
 *    new name → disk-only); not auto-reconciled.
 *  - Per-property sub-merge (e.g. shape from disk, source from tenant
 *    within the same field) is intentionally NOT done — it'd risk
 *    producing a structurally-malformed FieldDefinition (e.g. a
 *    shape:image with non-image source). Field is the unit of merge.
 *  - `variants[]`, `placeholders[]`, `placedIn[]`, `meta`, `datasource`
 *    are taken from the tenant base for ComponentTemplate — those have
 *    their own merge semantics that this MVP doesn't tackle.
 *
 * Returns the tenantRecipe untouched when the IR maps couldn't be
 * built (defensive).
 */
export const mergeTemplateRecipe = (
  diskRecipe: ComponentTemplateRecipe | ContentTemplateRecipe | PageTemplateRecipe,
  tenantRecipe: ComponentTemplateRecipe | ContentTemplateRecipe | PageTemplateRecipe,
  statuses: PerFieldStatuses,
  diskIr: OperationIr,
  tenantIr: OperationIr,
  /** Per-(rawKey) override for the winner decision (merge-plan file). */
  winnerOverrides?: Map<string, "disk" | "tenant">
): ComponentTemplateRecipe | ContentTemplateRecipe | PageTemplateRecipe => {
  const diskIndex = templateFieldRefKeyIndex(diskIr);
  const tenantIndex = templateFieldRefKeyIndex(tenantIr);
  // Pre-group the statuses map ONCE — without this, every per-field
  // winnerFor call walked the full statuses Map looking for `startsWith`
  // matches (O(T × S)). Grouped lookup is O(1) per field.
  const grouped = groupStatusesByOwnerRefKey(statuses);

  /**
   * Pick disk or tenant for a single field by name. Template-field
   * rawKeys are the field item's refKey itself (no `|name:...|lang|ver`
   * suffix — the merge-plan keys this entry by the bare refKey).
   */
  const winnerFor = (fieldName: string, kind: "fields" | "params"): "disk" | "tenant" => {
    const refKey =
      diskIndex[kind].get(fieldName.toLowerCase()) ??
      tenantIndex[kind].get(fieldName.toLowerCase());
    if (refKey === undefined) return "tenant";
    const override = winnerOverrides?.get(refKey.toLowerCase());
    if (override !== undefined) return override;
    const status = templateFieldRollup(refKey, grouped);
    return status === "disk-ahead" ? "disk" : "tenant";
  };

  const mergeFieldList = (
    diskFields: ReadonlyArray<FieldDefinition> | undefined,
    tenantFields: ReadonlyArray<FieldDefinition> | undefined,
    kind: "fields" | "params"
  ): FieldDefinition[] => {
    const diskByName = new Map<string, FieldDefinition>();
    for (const f of diskFields ?? []) diskByName.set(f.name.toLowerCase(), f);
    const tenantByName = new Map<string, FieldDefinition>();
    for (const f of tenantFields ?? []) tenantByName.set(f.name.toLowerCase(), f);
    // Order: prefer tenant order (the array we're synthesising starts
    // from tenant), then append disk-only fields at the end.
    const merged: FieldDefinition[] = [];
    const seen = new Set<string>();
    for (const tenantField of tenantFields ?? []) {
      const key = tenantField.name.toLowerCase();
      const choose = winnerFor(tenantField.name, kind);
      const diskField = diskByName.get(key);
      merged.push(choose === "disk" && diskField !== undefined ? diskField : tenantField);
      seen.add(key);
    }
    for (const diskField of diskFields ?? []) {
      const key = diskField.name.toLowerCase();
      if (seen.has(key)) continue;
      // Disk-only field: either a local addition (disk-ahead) or a
      // tenant-side deletion. Default is "preserve disk" (safe — the
      // operator most likely added it locally), but honour an explicit
      // `--apply-plan` override of `winner: "tenant"` to accept the
      // deletion. Default (no override) → keep disk.
      const refKey =
        diskIndex[kind].get(diskField.name.toLowerCase()) ??
        tenantIndex[kind].get(diskField.name.toLowerCase());
      const override =
        refKey !== undefined ? winnerOverrides?.get(refKey.toLowerCase()) : undefined;
      if (override === "tenant") continue; // operator accepted the deletion
      merged.push(diskField);
    }
    return merged;
  };

  // Start from tenant base — preserves displayName, description,
  // variants, placeholders, section, meta, datasource, etc. that
  // template-level merge doesn't tackle.
  const merged = { ...tenantRecipe } as
    | ComponentTemplateRecipe
    | ContentTemplateRecipe
    | PageTemplateRecipe;

  merged.fields = mergeFieldList(diskRecipe.fields, tenantRecipe.fields, "fields");

  if (diskRecipe.kind === "component-template" && tenantRecipe.kind === "component-template") {
    const diskComponent = diskRecipe as ComponentTemplateRecipe;
    const tenantComponent = tenantRecipe as ComponentTemplateRecipe;
    if (
      (diskComponent.params && diskComponent.params.length > 0) ||
      (tenantComponent.params && tenantComponent.params.length > 0)
    ) {
      (merged as ComponentTemplateRecipe).params = mergeFieldList(
        diskComponent.params,
        tenantComponent.params,
        "params"
      );
    }
  }

  return merged;
};

/**
 * Roll per-property statuses up to one entry per template field. The
 * underlying IR emits multiple SetField ops per template-field item
 * (Type, Source, Title, SortOrder, Shared, ...), so the raw
 * `PerFieldStatuses` map has multiple entries per recipe-author-visible
 * field. The merge-plan + the `mergeTemplateRecipe.winnerFor` lookup
 * both operate at the *field* level (bare fieldRefKey); without this
 * rollup the plan's per-property keys never match the lookup's bare
 * keys and overrides are silently dropped (audit B1).
 *
 * Returns `{ statuses, labels }` so composeMergePlan can pre-fill
 * winners with the right rollup AND show "Title" instead of "type" in
 * the plan file (audit N1).
 */
const rollupTemplateStatuses = (
  fieldStatuses: PerFieldStatuses,
  ir: OperationIr
): { statuses: PerFieldStatuses; labels: Map<string, string> } => {
  const statuses: PerFieldStatuses = new Map();
  const labels = new Map<string, string>();
  const index = templateFieldRefKeyIndex(ir);
  // Same pre-group optimisation as `mergeTemplateRecipe` — without it
  // each `templateFieldRollup` walks the full fieldStatuses Map.
  const grouped = groupStatusesByOwnerRefKey(fieldStatuses);
  const fold = (entries: Map<string, string>, suffix?: string): void => {
    for (const [fieldName, refKey] of entries) {
      const rollup = templateFieldRollup(refKey, grouped);
      if (rollup === undefined) continue;
      const key = refKey.toLowerCase();
      statuses.set(key, rollup);
      labels.set(key, suffix ? `${fieldName}${suffix}` : fieldName);
    }
  };
  fold(index.fields);
  fold(index.params, " (param)");
  return { statuses, labels };
};

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
 * Serialise one Recipe to disk as `<outDir>/<kind>/<slug>.recipe.json`.
 * Creates the per-kind directory on demand.
 */
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

/**
 * Atomic write helper — temp file in the same directory, then rename.
 * A concurrent reader sees either the old file or the new one, never a
 * half-written truncation. Process crash mid-write leaves the original
 * untouched (rename hasn't happened yet); crash after rename leaves
 * the new file fully written. Used for every file scai's pull task
 * lands on the operator's FS.
 */
const writeFileAtomic = async (filePath: string, contents: string): Promise<void> => {
  const tmpPath = `${filePath}.${process.pid}.${Math.floor(Math.random() * 1e9)}.tmp`;
  await fs.writeFile(tmpPath, contents, "utf8");
  await fs.rename(tmpPath, filePath);
};

const writeRecipeJson = async (
  outDir: string,
  recipe: Recipe & { handle: string }
): Promise<string> => {
  const kindDir = path.join(outDir, recipe.kind);
  const filePath = path.join(kindDir, `${slugifyHandle(recipe.handle)}.recipe.json`);
  // Defensive against a path-traversal regression: handleOf in
  // read-current.ts validates the tenant-stamped marker, but a second
  // line of defence here catches any future identity-string source
  // that forgets to sanitise.
  assertWithinDir(outDir, filePath);
  await fs.mkdir(kindDir, { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(recipe, null, 2)}\n`);
  return filePath;
};

export const runRecipePull = async (options: RecipePullOptions): Promise<RecipePullResult> => {
  const logger = toLogger(options);
  const tenant = resolveTenant(options);
  const roots = resolveRoots(options, tenant.environment);

  const tenantRecipes = await readCurrentRecipes(roots, tenant.client);
  if (tenantRecipes === null) {
    throw createScaiError(
      `No recipe-projectable roots are configured for environment '${tenant.envName}'.`,
      "INPUT_INVALID",
      {
        hint: "Set at least one of templatesRoot, componentsRoot, contentModelsRoot, pageTemplatesRoot, enumerationsRoot, partialDesignsRoot, pageDesignsRoot, pagesRoot, placeholderSettingsRoot, or contentItemsRoot in the env profile, or pass the matching --*-root flag.",
      }
    );
  }

  const outputDir = path.resolve(options.output ?? "./pulled-recipes");
  const dryRun = Boolean(options.dryRun);
  // Dry-run skips every fs.writeFile / mkdir; classification + reads
  // still happen so the operator sees the full diff without touching
  // the FS.
  if (!dryRun) await fs.mkdir(outputDir, { recursive: true });

  const byStatus: Record<RecipeMergeStatus, number> = {
    "in-sync": 0,
    "disk-ahead": 0,
    "tenant-edited": 0,
    conflict: 0,
    "disk-only": 0,
    "tenant-only": 0,
  };

  // ───── Snapshot mode (no --against) ────────────────────────────────────
  // No disk discovery, no classification — just dump tenant recipes.
  // Every entry gets status "in-sync" (the bare-minimum classification)
  // so the result shape stays uniform across modes.
  if (options.against === undefined) {
    const files: RecipePullEntry[] = [];
    const byKind: Record<string, number> = {};
    for (const recipe of tenantRecipes) {
      const filePath = dryRun
        ? null
        : await writeRecipeJson(outputDir, recipe as Recipe & { handle: string });
      files.push({
        handle: (recipe as { handle: string }).handle,
        kind: recipe.kind,
        path: filePath,
        status: "in-sync",
      });
      byKind[recipe.kind] = (byKind[recipe.kind] ?? 0) + 1;
      byStatus["in-sync"] += 1;
    }
    const result: RecipePullResult = {
      outputDir,
      totalRecipes: tenantRecipes.length,
      byKind,
      byStatus,
      files,
      blocked: false,
    };
    if (logger.isJson()) {
      logger.json({ command: "recipe.pull", environment: tenant.envName, ...result });
      return result;
    }
    logger.info(
      `Pulled ${result.totalRecipes} recipes from ${tenant.envName} to ${outputDir}`,
      "cyan"
    );
    for (const [kind, count] of Object.entries(result.byKind).sort()) {
      logger.info(`  ${kind}: ${count}`);
    }
    if (result.totalRecipes === 0) {
      logger.info(
        "  (no recipes recovered — verify env-profile roots and that tenant items carry the SCAI Handle marker)",
        "yellow"
      );
    }
    return result;
  }

  // ───── Merge mode (--against set) ──────────────────────────────────────
  // 1. Read disk recipes (sourced from --against or the config glob)
  // 2. Compile both sides to IRs through the same compile pipeline
  // 3. Hash each side via collectBaselineEntries
  // 4. Load baseline per recipe
  // 5. Classify per recipe + apply --policy (or --apply-plan winners)
  const policy = options.conflictPolicy ?? "error";

  // Load + validate the merge plan up front when --apply-plan is set.
  // The plan's environment must match the current run's env (a plan
  // generated against staging shouldn't accidentally apply to prod).
  // Per-(recipe, field) winner-override maps are built here; per-recipe
  // entries are looked up by handle in the loop below.
  const winnerOverridesByHandle = new Map<string, Map<string, "disk" | "tenant">>();
  let appliedPlan: MergePlan | null = null;
  if (options.applyPlan !== undefined) {
    appliedPlan = await loadMergePlan(options.applyPlan);
    if (appliedPlan.environment !== tenant.envName) {
      throw createScaiError(
        `Merge plan was generated against environment '${appliedPlan.environment}' but pull is running against '${tenant.envName}'.`,
        "INPUT_INVALID",
        {
          hint: "Regenerate the plan against the current environment (`recipe pull --against ... --write-plan ...`) or run pull against the matching env.",
        }
      );
    }
    for (const recipeEntry of appliedPlan.recipes) {
      const overrides = new Map<string, "disk" | "tenant">();
      for (const field of recipeEntry.fields) {
        overrides.set(field.rawKey.toLowerCase(), field.winner);
      }
      winnerOverridesByHandle.set(recipeEntry.handle, overrides);
    }
  }

  // Reuse push's input resolution + roots resolution so the merge
  // semantics match what push would compile against. `resolveRecipeInputs`
  // honors the config glob when input isn't a single file.
  const { files: diskFiles } = await resolveRecipeInputs(
    { ...options, input: options.against },
    tenant.root
  );
  const diskFilesOnly = diskFiles.filter((f) => !f.endsWith(".ir.json"));
  const diskRecipes: Recipe[] = await mapWithConcurrency(diskFilesOnly, (f) => loadRecipe(f));

  const { templatesRoot, renderingsRoot } = resolveRecipeRoots(
    options,
    tenant.environment,
    tenant.envName,
    recipeSetNeedsRoots(diskRecipes) || recipeSetNeedsRoots(tenantRecipes)
  );
  const compileContext = {
    templatesRoot,
    renderingsRoot,
    componentsRoot: options.componentsRoot ?? tenant.environment.componentsRoot,
    contentModelsRoot: options.contentModelsRoot ?? tenant.environment.contentModelsRoot,
    partialDesignsRoot: options.partialDesignsRoot ?? tenant.environment.partialDesignsRoot,
    pageDesignsRoot: options.pageDesignsRoot ?? tenant.environment.pageDesignsRoot,
    contentItemsRoot: options.contentItemsRoot ?? tenant.environment.contentItemsRoot,
    headlessVariantsRoot: tenant.environment.headlessVariantsRoot,
    availableRenderingsRoot: tenant.environment.availableRenderingsRoot,
    enumerationsRoot: options.enumerationsRoot ?? tenant.environment.enumerationsRoot,
    pageTemplatesRoot: options.pageTemplatesRoot ?? tenant.environment.pageTemplatesRoot,
    placeholderSettingsRoot:
      options.placeholderSettingsRoot ?? tenant.environment.placeholderSettingsRoot,
    pagesRoot: options.pagesRoot ?? tenant.environment.pagesRoot,
  };
  const diskIrs = compileRecipeSet(diskRecipes, compileContext);
  const tenantIrs = compileRecipeSet(tenantRecipes, compileContext);

  // Hash maps keyed by recipe handle.
  const diskHashByHandle = new Map<string, Map<string, string>>();
  const diskIrByHandle = new Map<string, OperationIr>();
  for (const ir of diskIrs) {
    diskHashByHandle.set(ir.recipeHandle, indexHashes(collectBaselineEntries(ir, new Map())));
    diskIrByHandle.set(ir.recipeHandle, ir);
  }
  const tenantHashByHandle = new Map<string, Map<string, string>>();
  const tenantIrByHandle = new Map<string, OperationIr>();
  for (const ir of tenantIrs) {
    tenantHashByHandle.set(ir.recipeHandle, indexHashes(collectBaselineEntries(ir, new Map())));
    tenantIrByHandle.set(ir.recipeHandle, ir);
  }

  // Build a recipe-by-handle lookup for both sides so the per-recipe loop
  // can re-emit the right Recipe object based on the status.
  //
  // Detect cross-kind collisions early — two recipes on the same side
  // sharing a handle but differing in kind would silently overwrite
  // each other and the merge loop would later fall through to a tenant
  // write with no diagnostic (last-write-wins). Throw `INPUT_INVALID`
  // so the operator sees the collision before any file is written.
  const buildRecipeByHandle = (
    label: "disk" | "tenant",
    list: readonly Recipe[]
  ): Map<string, Recipe> => {
    const out = new Map<string, Recipe>();
    for (const r of list) {
      const handle = (r as { handle: string }).handle;
      const existing = out.get(handle);
      if (existing && existing.kind !== r.kind) {
        throw createScaiError(
          `Handle collision on ${label}: '${handle}' appears as both ${existing.kind} and ${r.kind}.`,
          "INPUT_INVALID",
          {
            hint: "Recipe handles must be unique per side. Rename one of the colliding recipes (or merge them) and re-run.",
          }
        );
      }
      out.set(handle, r);
    }
    return out;
  };
  const diskRecipeByHandle = buildRecipeByHandle("disk", diskRecipes);
  const tenantRecipeByHandle = buildRecipeByHandle("tenant", tenantRecipes);
  // Also check cross-side: the same handle on both sides MUST have the
  // same kind for the synthesis path to make sense. Different kinds
  // would fall through to the else-branch (write tenant) silently —
  // surface as an error instead.
  for (const [handle, diskRecipe] of diskRecipeByHandle) {
    const tenantRecipe = tenantRecipeByHandle.get(handle);
    if (tenantRecipe !== undefined && tenantRecipe.kind !== diskRecipe.kind) {
      throw createScaiError(
        `Cross-side kind mismatch for handle '${handle}': disk is ${diskRecipe.kind}, tenant is ${tenantRecipe.kind}.`,
        "INPUT_INVALID",
        {
          hint: "The same handle must resolve to the same kind on both sides. One side may have been authored against an older schema, or two recipes accidentally share a handle.",
        }
      );
    }
  }

  const configDir = path.dirname(tenant.root.physicalPath);
  const allHandles = new Set<string>([
    ...diskRecipeByHandle.keys(),
    ...tenantRecipeByHandle.keys(),
  ]);

  // Pluggable baseline storage. Defaults to file-backed under
  // <configDir>/.scai/baseline/. Operators can pass a custom impl
  // (orchestrator-hosted, in-memory) via RecipePullOptions.baselineStorage.
  const baselineStorage = options.baselineStorage ?? new FileBaselineStorage(configDir);

  // Parallel baseline preload: file storage is mostly disk-bound and
  // loads are independent per-recipe. Pre-fetching here lets the main
  // loop run with all baselines in hand — no sequential await inside
  // the loop. The Map is built once + read by reference.
  const baselineHashesByHandle = new Map<string, Map<string, string> | null>();
  if (!options.noBaseline) {
    const handlesNeedingBaseline = [...allHandles];
    const baselineEntries = await mapWithConcurrency(handlesNeedingBaseline, async (handle) => {
      const baseline = await baselineStorage.load(tenant.envName, handle);
      return [handle, baseline ? indexHashes(baseline.fields) : null] as const;
    });
    for (const [handle, hashes] of baselineEntries) baselineHashesByHandle.set(handle, hashes);
  }

  // Apply-plan: verify every plan-referenced recipe is in the current
  // run. A plan entry whose handle disappeared (operator deleted the
  // recipe between write-plan + apply-plan, or pull is running against
  // a different recipe set) means the plan is stale; refuse to apply
  // it. Extra recipes in the current run that aren't in the plan are
  // fine — they just use the policy defaults.
  if (appliedPlan !== null) {
    const missingFromCurrent = appliedPlan.recipes
      .map((r) => r.handle)
      .filter((h) => !allHandles.has(h));
    if (missingFromCurrent.length > 0) {
      throw createScaiError(
        `Merge plan references ${missingFromCurrent.length} recipe(s) that aren't in the current set.`,
        "INPUT_INVALID",
        {
          hint: "Regenerate the plan (`recipe pull --against ... --write-plan ...`) — the recipe set has changed since the plan was written.",
          details: missingFromCurrent.map(
            (h) => `Plan handle '${h}' not found in current disk + tenant set.`
          ),
        }
      );
    }
  }

  const files: RecipePullEntry[] = [];
  const byKind: Record<string, number> = {};
  let blocked = false;
  // Per-recipe entries to compose into the merge-plan file (when
  // --write-plan is set). Collected during the per-handle loop and
  // emitted after, so the plan reflects the same classifications the
  // result entries do.
  //
  // For template-style recipes the statuses are pre-rolled (per-property
  // statuses collapsed to one entry per template field) so the plan +
  // mergeTemplateRecipe.winnerFor agree on the key shape. Labels are
  // also pre-computed so the plan shows "Title (param)" rather than the
  // unrecognisable bare fieldRefKey under humanizeFieldKey.
  const planSourceEntries: Array<{
    handle: string;
    kind: string;
    rollupStatus: RecipeMergeStatus;
    fieldStatuses: PerFieldStatuses;
    labels?: Map<string, string>;
  }> = [];
  for (const handle of allHandles) {
    const diskRecipe = diskRecipeByHandle.get(handle);
    const tenantRecipe = tenantRecipeByHandle.get(handle);
    const diskHashes = diskHashByHandle.get(handle) ?? null;
    const tenantHashes = tenantHashByHandle.get(handle) ?? null;
    const baselineHashes = baselineHashesByHandle.get(handle) ?? null;

    // Per-field statuses first, then roll up. Both sides of the diff
    // share the same status; the rollup is what gates write decisions
    // + the CLI error gate, the per-field map is what drives the
    // tenant-wins merge synthesis below.
    const fieldStatuses = perFieldStatuses(diskHashes, tenantHashes, baselineHashes);

    // Disk-only / tenant-only short-circuits — these aren't per-field
    // classifiable since one side has no fields to compare to. Roll up
    // by structural presence first.
    let status: RecipeMergeStatus;
    let diskChanged: number;
    let tenantChanged: number;
    if (diskHashes === null && tenantHashes === null) {
      status = "in-sync";
      diskChanged = 0;
      tenantChanged = 0;
    } else if (diskHashes === null) {
      status = "tenant-only";
      diskChanged = 0;
      tenantChanged = 0;
    } else if (tenantHashes === null) {
      status = "disk-only";
      diskChanged = 0;
      tenantChanged = 0;
    } else {
      const rolled = rollupPerFieldStatuses(fieldStatuses);
      status = rolled.status;
      diskChanged = rolled.diskChanged;
      tenantChanged = rolled.tenantChanged;
    }

    // Per-field statuses surfaced on the result for JSON consumers /
    // verbose human output. Convert the opaque baselineLookupKey to a
    // pair of (fieldName, lang?, version?) for readability.
    const perFieldList: Array<{
      key: string;
      status: FieldMergeStatus;
    }> = [];
    for (const [key, fieldStatus] of fieldStatuses) {
      perFieldList.push({ key: humanizeFieldKey(key), status: fieldStatus });
    }

    // Decide whether to write a recipe file for this handle.
    const shouldWrite = (() => {
      if (!tenantRecipe && !diskRecipe) return false;
      // Apply-plan mode always writes — the plan IS the policy.
      if (appliedPlan !== null) return true;
      switch (policy) {
        case "tenant-wins":
          // Always emit a recipe file — either tenant-only, or a per-field
          // merge synthesized below.
          return tenantRecipe !== undefined || diskRecipe !== undefined;
        case "disk-wins":
          // Only write when the disk side has no changes (in-sync or
          // tenant-only or tenant-edited cases). Skip disk-ahead +
          // conflict so the operator's local recipe stays the source of
          // truth in the output directory.
          return (
            tenantRecipe !== undefined &&
            (status === "in-sync" || status === "tenant-only" || status === "tenant-edited")
          );
        case "error":
        default:
          // Default policy: write `in-sync` + `tenant-only` (safe), skip
          // anything that needs operator attention so the file list
          // reflects what's actually been merged.
          return tenantRecipe !== undefined && (status === "in-sync" || status === "tenant-only");
      }
    })();

    let filePath: string | null = null;
    if (shouldWrite) {
      // Per-field merge applies under `tenant-wins` for content-bearing
      // kinds (ContentItem, Page) when both sides exist. Synthesises a
      // Recipe that takes tenant's values where tenant moved, keeps
      // disk's values where only disk moved, and falls back to tenant
      // for the rest. Other kinds (templates, designs, placeholders)
      // adopt the tenant projection wholesale — their "fields" are
      // schema definitions, not values, and field-level merge there
      // would risk producing a malformed template.
      // Operator-supplied per-(rawKey) overrides from --apply-plan (if
      // any). When `applyPlan` is set + this recipe is in the plan, the
      // overrides win per-field; otherwise the policy default applies.
      const overridesForRecipe = winnerOverridesByHandle.get(handle);
      // Staleness verification: when applying a plan, compare each
      // plan-recorded field status to the current classification. A
      // mismatch means the world moved between write-plan + apply-plan
      // (someone pushed, someone edited tenant, baseline rewrote), and
      // applying the stale plan could clobber a fresh edit. Refuse and
      // ask the operator to regenerate.
      if (appliedPlan !== null && overridesForRecipe !== undefined) {
        const planEntry = appliedPlan.recipes.find((r) => r.handle === handle);
        if (planEntry !== undefined) {
          const planEntryKind = (tenantRecipe ?? diskRecipe)?.kind;
          // Templates compare against the rolled-up statuses (one per
          // field); content kinds compare against raw fieldStatuses.
          const compareStatuses = ((): PerFieldStatuses => {
            if (
              planEntryKind === "component-template" ||
              planEntryKind === "content-template" ||
              planEntryKind === "page-template"
            ) {
              const ir = tenantIrByHandle.get(handle) ?? diskIrByHandle.get(handle);
              return ir ? rollupTemplateStatuses(fieldStatuses, ir).statuses : fieldStatuses;
            }
            return fieldStatuses;
          })();
          const drifted = detectStalePlanDrift(planEntry, compareStatuses);
          if (drifted.length > 0) {
            throw createScaiError(
              `Stale merge plan for recipe '${handle}': ${drifted.length} field(s) classify differently now than when the plan was generated.`,
              "INPUT_INVALID",
              {
                hint: "The world moved between --write-plan and --apply-plan. Regenerate the plan (`recipe pull --against ... --write-plan ...`) to see the new state and re-pick winners.",
                details: drifted,
              }
            );
          }
        }
      }
      // Apply-plan mode also forces the per-field merge path (i.e.
      // tenant-wins synthesis behaviour) regardless of the conflictPolicy
      // — the plan IS the policy. Without overrides we fall back to the
      // existing policy switch.
      const effectivePolicy: "error" | "disk-wins" | "tenant-wins" =
        appliedPlan !== null ? "tenant-wins" : policy;
      // Per-recipe write choice:
      //   disk-wins: prefer disk recipe whole (the policy literally
      //     says "disk wins" — write the operator's local view to
      //     outDir). Falls back to tenant when disk is absent
      //     (tenant-only).
      //   tenant-wins: per-field merge for content + template kinds;
      //     other kinds fall through to tenant whole.
      //   error: only in-sync + tenant-only reach this branch per
      //     shouldWrite; tenant is correct in both cases.
      let recipeToWrite: Recipe;
      if (effectivePolicy === "disk-wins") {
        recipeToWrite = (diskRecipe ?? tenantRecipe)!;
      } else if (
        effectivePolicy === "tenant-wins" &&
        diskRecipe !== undefined &&
        tenantRecipe !== undefined &&
        (tenantRecipe.kind === "content-item" || tenantRecipe.kind === "page") &&
        diskRecipe.kind === tenantRecipe.kind
      ) {
        const tenantIr = tenantIrByHandle.get(handle);
        const mainRefKey = tenantIr ? findMainItemRefKey(tenantIr, tenantRecipe.kind) : undefined;
        recipeToWrite = mergeContentValueRecipe(
          diskRecipe as ContentItemRecipe | PageRecipe,
          tenantRecipe as ContentItemRecipe | PageRecipe,
          fieldStatuses,
          mainRefKey,
          overridesForRecipe
        );
      } else if (
        effectivePolicy === "tenant-wins" &&
        diskRecipe !== undefined &&
        tenantRecipe !== undefined &&
        (tenantRecipe.kind === "component-template" ||
          tenantRecipe.kind === "content-template" ||
          tenantRecipe.kind === "page-template") &&
        diskRecipe.kind === tenantRecipe.kind
      ) {
        // Template-style recipes: per-field merge matches by field name
        // (FieldDefinition is the merge unit, not its sub-properties).
        const diskIr = diskIrByHandle.get(handle);
        const tenantIr = tenantIrByHandle.get(handle);
        if (diskIr !== undefined && tenantIr !== undefined) {
          recipeToWrite = mergeTemplateRecipe(
            diskRecipe as ComponentTemplateRecipe | ContentTemplateRecipe | PageTemplateRecipe,
            tenantRecipe as ComponentTemplateRecipe | ContentTemplateRecipe | PageTemplateRecipe,
            fieldStatuses,
            diskIr,
            tenantIr,
            overridesForRecipe
          );
        } else {
          // Defensive: IR missing for one side → fall back to tenant.
          recipeToWrite = tenantRecipe;
        }
      } else {
        recipeToWrite = (tenantRecipe ?? diskRecipe)!;
      }
      filePath = dryRun
        ? null
        : await writeRecipeJson(outputDir, recipeToWrite as Recipe & { handle: string });
    }

    const kind = (tenantRecipe ?? diskRecipe)!.kind;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    byStatus[status] += 1;
    files.push({
      handle,
      kind,
      path: filePath,
      status,
      diskChangedFields: diskChanged,
      tenantChangedFields: tenantChanged,
      ...(perFieldList.length > 0 && { fieldStatuses: perFieldList }),
    });

    // Templates need their per-property statuses rolled up to one
    // entry per field for the merge plan; content kinds use the raw
    // map (already at field-level resolution).
    if (kind === "component-template" || kind === "content-template" || kind === "page-template") {
      const ir = tenantIrByHandle.get(handle) ?? diskIrByHandle.get(handle);
      if (ir !== undefined) {
        const { statuses: rolled, labels } = rollupTemplateStatuses(fieldStatuses, ir);
        planSourceEntries.push({
          handle,
          kind,
          rollupStatus: status,
          fieldStatuses: rolled,
          labels,
        });
      } else {
        planSourceEntries.push({ handle, kind, rollupStatus: status, fieldStatuses });
      }
    } else {
      planSourceEntries.push({ handle, kind, rollupStatus: status, fieldStatuses });
    }

    // Apply-plan mode short-circuits the error gate — the operator
    // already reviewed + committed their picks by editing the plan;
    // exit non-zero would defeat the purpose of running --apply-plan.
    if (
      appliedPlan === null &&
      policy === "error" &&
      (status === "tenant-edited" || status === "conflict")
    ) {
      blocked = true;
    }
  }

  // Write the merge plan when --write-plan is set. Done after the loop
  // so the plan reflects the same per-recipe classifications + per-field
  // statuses the result entries do. Uses an opt-passed `now` for tests;
  // production stamps the current time.
  if (options.writePlan !== undefined && !dryRun) {
    const generatedAt = options.now ?? new Date().toISOString();
    const plan = composeMergePlan(tenant.envName, policy, generatedAt, planSourceEntries);
    const planPath = path.resolve(options.writePlan);
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await writeFileAtomic(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  }

  const result: RecipePullResult = {
    outputDir,
    totalRecipes: allHandles.size,
    byKind,
    byStatus,
    files,
    blocked,
  };

  if (logger.isJson()) {
    logger.json({
      command: "recipe.pull",
      environment: tenant.envName,
      mode: "merge",
      policy,
      ...result,
    });
    return result;
  }

  logger.info(
    `Pulled ${result.totalRecipes} recipes from ${tenant.envName} (merge against ${options.against}, policy=${policy})`,
    "cyan"
  );
  for (const [statusKey, count] of Object.entries(byStatus).sort()) {
    if (count === 0) continue;
    const color =
      statusKey === "conflict" || statusKey === "tenant-edited"
        ? "yellow"
        : statusKey === "disk-only"
          ? "yellow"
          : "green";
    logger.info(`  ${statusKey}: ${count}`, color);
  }
  for (const entry of files) {
    if (entry.status === "in-sync") continue;
    const tag =
      entry.status === "tenant-edited" || entry.status === "conflict"
        ? "!"
        : entry.status === "disk-ahead"
          ? "+"
          : "?";
    logger.info(
      `  [${tag}] ${entry.handle}  ${entry.status}` +
        (entry.diskChangedFields || entry.tenantChangedFields
          ? `  (disk:${entry.diskChangedFields}, tenant:${entry.tenantChangedFields})`
          : "") +
        (entry.path ? `  → ${path.relative(outputDir, entry.path)}` : "")
    );
  }
  if (blocked) {
    logger.info(
      `  ! blocked by --policy=error: ${byStatus["tenant-edited"]} tenant-edited + ${byStatus.conflict} conflict`,
      "yellow"
    );
  }
  return result;
};
