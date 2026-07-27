/**
 * Three-way merge baseline — the "last-applied" leg of recipe ↔ tenant ↔
 * baseline diffing.
 *
 * Without a baseline, scai's planner is a TWO-way diff: it sees the recipe
 * (desired) vs the tenant (live) and treats any divergence as recipe-wins
 * drift. That silently clobbers author edits — a field the author edited
 * in the Sitecore UI after the last push reads as "tenant disagrees with
 * recipe", and the planner schedules an `update` that overwrites it.
 *
 * With a baseline, the planner classifies per-field:
 *
 *   R == B && C == B   → no-op (idempotent)
 *   R != B && C == B   → recipe change, tenant unchanged → safe `update`
 *   R == B && C != B   → AUTHOR EDIT detected (cms-edit) — surface, don't clobber
 *   R != B && C != B   → CONFLICT — both sides moved. Default `error`.
 *
 * Baseline storage is per-(env, recipe) on the operator's filesystem:
 *
 *   <configDir>/.scai/baseline/<envName>/<slug(handle)>.baseline.json
 *
 * Same slug rules as `defaultIrPath` in io.ts (`@` → `_v`). The file is
 * a flat list of per-field hash entries (one per SetField mutation the
 * last push wrote). Hashes (SHA-256 of `renderRefValue(value)`) keep the
 * baseline small and avoid storing tenant content verbatim — sufficient
 * to detect "tenant matches last-applied" vs "tenant has drifted",
 * insufficient for true three-way value merge (that's UI territory).
 *
 * Compared with the Tier 3 design — file-based baseline IS the MVP. The
 * remote orchestrator-backed baseline (shareable across operators / CI)
 * is the follow-on.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createScaiError } from "@/shared/errors";
import { LAYOUT_FIELDS } from "../ir/sitecore-templates";
import { parseLayoutXml, type ParsedLayout } from "../layout/parse";

/**
 * One field's last-applied state — what the previous successful push
 * wrote to (itemRefKey, fieldId, language?, version?). The hash is
 * SHA-256 hex of the wire-form string (`renderRefValue(value)`).
 *
 * `fieldName` is carried alongside `fieldId` because recipe-created
 * fields' fieldIds are IR-internal refKeys (not the server-assigned
 * GUIDs); the planner matches by name when present, fieldId otherwise.
 */
export const BaselineFieldEntrySchema = z.object({
  itemRefKey: z.string(),
  fieldId: z.string(),
  fieldName: z.string().optional(),
  language: z.string().optional(),
  version: z.number().int().positive().optional(),
  valueHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type BaselineFieldEntry = z.infer<typeof BaselineFieldEntrySchema>;

/**
 * One recipe's baseline document. Stored at
 * `<configDir>/.scai/baseline/<envName>/<slug(handle)>.baseline.json` after
 * a successful apply.
 */
export const BaselineSchema = z.object({
  schemaVersion: z.literal("1"),
  recipeHandle: z.string(),
  envName: z.string(),
  /** ISO 8601 timestamp the previous apply finished. Display-only. */
  capturedAt: z.string(),
  fields: z.array(BaselineFieldEntrySchema),
});

export type Baseline = z.infer<typeof BaselineSchema>;

/**
 * Stable hash of a rendered field value — SHA-256 hex. Inputs are the
 * exact wire-form strings the executor writes / the planner reads, so
 * hashing on either side compares apples to apples.
 *
 * Whitespace and case are NOT normalised — Sitecore returns the same
 * bytes on read that it wrote, and a normaliser here would mis-classify
 * legitimate whitespace edits as "no change". The one exception is layout
 * XML, which Sitecore canonicalises server-side; the planner handles that
 * via `layoutXmlEquivalent` separately and does NOT use this hash for
 * layout fields.
 */
export const hashFieldValue = (renderedValue: string): string =>
  createHash("sha256").update(renderedValue, "utf8").digest("hex");

/**
 * Sitecore field GUIDs whose values are layout XML — push-emitted
 * canonical, tenant-returned SXA delta. These need
 * `canonicaliseLayoutXml` before hashing.
 */
export const isLayoutFieldId = (fieldId: string): boolean =>
  fieldId.toLowerCase() === LAYOUT_FIELDS.RENDERINGS.toLowerCase() ||
  fieldId.toLowerCase() === LAYOUT_FIELDS.FINAL_RENDERINGS.toLowerCase();

/**
 * Canonicalise a layout XML string for stable hashing. Push emits
 * canonical XML; the tenant returns SXA delta XML (with `<p:da>`
 * directives) — the two wire forms differ byte-for-byte even for the
 * same logical layout, so raw `renderRefValue` hashing would diverge
 * on every push → re-read cycle.
 *
 * Approach: parse both forms via `parseLayoutXml` (it handles canonical
 * + delta) into a `ParsedLayout`, then serialise to a deterministic
 * JSON string with sorted placeholder keys and sorted per-placement
 * param keys. Two semantically-equal layouts hash identical regardless
 * of wire form, GUID case, or device-element ordering — the same
 * invariant `layoutXmlEquivalent` relies on for planner drift detection.
 *
 * Returns the original XML unchanged when parse fails (defensive — a
 * malformed layout shouldn't crash the hash path; fallback to raw
 * string compare which at least round-trips identically against itself).
 */
export const canonicaliseLayoutXml = (xml: string, preParsed?: ParsedLayout): string => {
  if (xml === "") return "";
  let parsed: ParsedLayout;
  if (preParsed !== undefined) {
    parsed = preParsed;
  } else {
    try {
      parsed = parseLayoutXml(xml);
    } catch {
      return xml;
    }
  }
  // Sort placeholder keys + serialise placements in render order
  // (input order is preserved by parseLayoutXml). Drop `mode` and
  // `layoutId` since they're metadata about the wire form, not the
  // logical layout itself.
  const sortedPlaceholders: Record<
    string,
    Array<{
      renderingGuid: string;
      uid: string;
      datasource?: ParsedLayout["placeholders"][string][number]["datasource"];
      variant?: string;
      params?: Record<string, string>;
    }>
  > = {};
  for (const key of Object.keys(parsed.placeholders).sort()) {
    sortedPlaceholders[key] = parsed.placeholders[key].map((p) => {
      const out: (typeof sortedPlaceholders)[string][number] = {
        renderingGuid: p.renderingGuid.toLowerCase(),
        uid: p.uid.toLowerCase(),
      };
      if (p.datasource) out.datasource = p.datasource;
      if (p.variant !== undefined) out.variant = p.variant;
      if (p.params !== undefined) {
        const sortedParams: Record<string, string> = {};
        for (const k of Object.keys(p.params).sort()) sortedParams[k] = p.params[k];
        out.params = sortedParams;
      }
      return out;
    });
  }
  return JSON.stringify({ placeholders: sortedPlaceholders });
};

/**
 * Hash a (fieldId, rendered-value) pair using the right pre-processing
 * for the field type. Layout fields canonicalise before hashing so push
 * + read round-trip cleanly; other fields hash the raw rendered value.
 * Shared between baseline-capture (write side) and the planner (read
 * side) so both ends compute the same hash for the same logical value.
 */
const GUID_SEGMENT =
  /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/;

/**
 * True when the rendered value is a pipe-separated list of GUIDs (one or
 * more) — the wire shape of `__Masters` (insert options), `__Base
 * template`, droplinks/multilists, etc.
 */
export const isGuidListValue = (value: string): boolean => {
  if (value === "") return false;
  return value.split("|").every((segment) => GUID_SEGMENT.test(segment.trim()));
};

/**
 * Canonicalise a GUID-list value for comparison/hashing: each segment
 * to braced-uppercase-dashed form. ORDER IS PRESERVED — multilist order
 * is author-meaningful in Sitecore (insert-option display order,
 * treelist ordering), so only the byte representation is normalised
 * (brace form, case, stray whitespace), not the semantics. This is the
 * GUID-list analogue of `canonicaliseLayoutXml`: scai writes via
 * `toCurly` ({UPPER}), but values that round-trip through the tenant or
 * arrive from author edits can differ in case/braces for the same
 * logical list — a raw string compare then reports phantom drift.
 */
export const canonicaliseGuidList = (value: string): string =>
  value
    .split("|")
    .map((segment) => `{${segment.trim().replace(/[{}]/g, "").toUpperCase()}}`)
    .join("|");

export const hashFieldValueForBaseline = (
  fieldId: string,
  renderedValue: string,
  /**
   * Optional pre-parsed layout — when the caller already parsed the XML
   * (e.g. `computeFieldDrift` parses once for `layoutXmlEquivalent`
   * AND for hashing), pass the parsed value to skip re-parsing here.
   * Halves layout parse cost on the planner's hot path.
   */
  preParsedLayout?: ParsedLayout
): string => {
  if (isLayoutFieldId(fieldId)) {
    return hashFieldValue(canonicaliseLayoutXml(renderedValue, preParsedLayout));
  }
  if (isGuidListValue(renderedValue)) {
    return hashFieldValue(canonicaliseGuidList(renderedValue));
  }
  return hashFieldValue(renderedValue);
};

/**
 * Compose a stable lookup key for a baseline entry. Matches the per-field
 * identity the planner uses: name-first when present (recipe-created
 * fields), GUID otherwise (system fields).
 */
const baselineLookupKey = (
  fieldId: string,
  fieldName: string | undefined,
  language: string | undefined,
  version: number | undefined
): string => {
  const idPart =
    fieldName !== undefined ? `name:${fieldName.toLowerCase()}` : `id:${fieldId.toLowerCase()}`;
  return `${idPart}|${language ?? ""}|${version ?? ""}`;
};

/**
 * Indexed view over a baseline — `(itemRefKey, fieldKey) → valueHash` —
 * for O(1) lookup during planning. Built once per recipe at plan-time;
 * the planner calls `lookup` per SetField op.
 */
export interface BaselineIndex {
  /**
   * Look up the last-applied value hash for one (item, field) cell.
   * Returns `undefined` when:
   *   - the baseline doesn't carry an entry for this item (recipe-created
   *     items that weren't in the previous push — new fields, new items),
   *   - the baseline file is absent (first push to this env),
   *   - or `null` baseline was passed (operator opted out via flag).
   */
  lookup: (
    itemRefKey: string,
    fieldId: string,
    fieldName: string | undefined,
    language: string | undefined,
    version: number | undefined
  ) => string | undefined;
  /** Underlying baseline document (`null` when none was loaded). */
  baseline: Baseline | null;
}

export const indexBaseline = (baseline: Baseline | null): BaselineIndex => {
  if (baseline === null) {
    return { lookup: () => undefined, baseline: null };
  }
  // (itemRefKey lowercased) → (fieldKey) → valueHash
  const byItem = new Map<string, Map<string, string>>();
  for (const entry of baseline.fields) {
    const itemKey = entry.itemRefKey.toLowerCase();
    let perItem = byItem.get(itemKey);
    if (!perItem) {
      perItem = new Map();
      byItem.set(itemKey, perItem);
    }
    perItem.set(
      baselineLookupKey(entry.fieldId, entry.fieldName, entry.language, entry.version),
      entry.valueHash
    );
  }
  return {
    baseline,
    lookup: (itemRefKey, fieldId, fieldName, language, version) => {
      const perItem = byItem.get(itemRefKey.toLowerCase());
      if (!perItem) return undefined;
      return perItem.get(baselineLookupKey(fieldId, fieldName, language, version));
    },
  };
};

const slugifyHandle = (handle: string): string => handle.replace(/@/g, "_v");

// ───────────────────────────────────────────────────────────────────────────
// Pluggable baseline storage
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pluggable backing store for per-(env, recipe) baseline snapshots —
 * the content-recipe-specific surface (2-arg `(envName, recipeHandle)`).
 *
 * Relationship with `@/sync`'s {@link import("@/sync").BaselineStorage}:
 * the sync interface is the multi-kind 3-arg surface used by every
 * non-content-recipe kind (brand, brief, campaign, story, …). Content
 * recipes pre-date the multi-kind shape and keep their 2-arg surface
 * for callsite ergonomics — pull/push.ts wire baselineStorage through
 * dozens of call sites, and the kind is always "content-recipe".
 *
 * Operators who want a single backing store across every kind plug a
 * sync `BaselineStorage` into the recipe pipeline via
 * {@link adaptSyncBaselineStorage} below. Internally that pins kind to
 * `"content-recipe"`; downstream every method signature collapses to
 * the 2-arg form callers already use.
 *
 * The default {@link FileBaselineStorage} writes to
 * `<configDir>/.scai/baseline/<env>/<slug(handle)>.baseline.json`. A
 * remote impl plugs in via the adapter; no recipe-side callsite changes.
 *
 * Contract:
 *  - `load` returns `null` for "no baseline yet" (first push to this
 *    (env, recipe) pair). Throws only on integrity errors — malformed
 *    data, unreachable backing store. Silently treating malformed data
 *    as "no baseline" would re-introduce the silent-clobber failure
 *    mode the baseline exists to prevent.
 *  - `write` replaces the baseline wholesale (no merge). Caller passes
 *    the full field list captured from the push that just succeeded.
 *  - `locator` returns a human-readable string for diagnostics
 *    ("file:/path/to/baseline.json", "orchestrator://env/recipe"). Used
 *    in log messages + error hints; never parsed.
 */
export interface BaselineStorage {
  load(envName: string, recipeHandle: string): Promise<Baseline | null>;
  write(envName: string, recipeHandle: string, baseline: Baseline): Promise<string>;
  /** Human-readable locator (for diagnostics; never parsed). */
  locator(envName: string, recipeHandle: string): string;
}

/**
 * Kind discriminator used when content-recipe baselines flow through a
 * multi-kind sync storage backend (HTTP, in-memory, etc.). Stable
 * because it's serialised into orchestrator-side URLs / column values.
 */
export const CONTENT_RECIPE_BASELINE_KIND = "content-recipe";

/**
 * Default storage: a directory under `<configDir>/.scai/baseline/`.
 * Per-(env, recipe) layout: `<envName>/<slug(handle)>.baseline.json`.
 * Mirrors the rest of scai's per-recipe artifact layout
 * (`.scai/<slug>.ir.json`, `.scai/<slug>.plan.json`).
 */
export class FileBaselineStorage implements BaselineStorage {
  constructor(public readonly configDir: string) {}

  /**
   * Defensive: assert that the composed path resolves inside the
   * `<configDir>/.scai/baseline/` container. Belt-and-braces against a
   * tenant-controlled `recipeHandle` (the recipe-handle map in pull's
   * merge mode is built from tenant projections; `handleOf` validates
   * the marker against HANDLE_PATTERN, but a regression in either
   * could otherwise let a malicious handle resolve outside the baseline
   * tree).
   */
  private assertWithinBaselineDir(filePath: string): void {
    const container = path.resolve(this.configDir, ".scai", "baseline");
    const rel = path.relative(container, path.resolve(filePath));
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "..") {
      throw createScaiError(
        `Refusing to access baseline outside the configured directory: ${filePath} (escape from ${container}).`,
        "INPUT_INVALID",
        {
          hint: "Inspect the recipeHandle that produced this path — it should match /^[a-z][a-z0-9-]*@[0-9]+$/.",
        }
      );
    }
  }

  locator(envName: string, recipeHandle: string): string {
    const filePath = path.join(
      this.configDir,
      ".scai",
      "baseline",
      envName,
      `${slugifyHandle(recipeHandle)}.baseline.json`
    );
    // Validate on construction so locator-only callers (`baselineFilePath`,
    // diagnostics, error messages) also benefit from the guard.
    this.assertWithinBaselineDir(filePath);
    return filePath;
  }

  async load(envName: string, recipeHandle: string): Promise<Baseline | null> {
    const filePath = this.locator(envName, recipeHandle);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw createScaiError(
        `Failed to read baseline ${filePath}: ${
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
        `Invalid JSON in baseline ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "INPUT_INVALID",
        {
          hint: "Delete the file to reset the baseline (the next successful push will rewrite it).",
        }
      );
    }
    const result = BaselineSchema.safeParse(parsed);
    if (!result.success) {
      throw createScaiError(`Invalid baseline at ${filePath}.`, "INPUT_INVALID", {
        hint: "Delete the file to reset the baseline (the next successful push will rewrite it).",
        details: result.error.issues.map(
          (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
        ),
      });
    }
    return result.data;
  }

  async write(envName: string, recipeHandle: string, baseline: Baseline): Promise<string> {
    BaselineSchema.parse(baseline);
    const filePath = this.locator(envName, recipeHandle);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Atomic write: temp file in the same directory, then rename. A
    // concurrent reader either sees the old file or the new one — never
    // a half-written truncation. Crash safety: if the process dies
    // mid-write, the original file is unchanged (the rename hasn't
    // happened); if it dies after rename, the new file is fully written.
    // PID + random suffix avoids name collisions across parallel pushes
    // to the same recipe (rare but possible in CI).
    const tmpPath = `${filePath}.${process.pid}.${Math.floor(Math.random() * 1e9)}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
    return filePath;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Backward-compatible loadBaseline / writeBaseline wrappers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve the on-disk path for a recipe's baseline file. Convenience
 * shorthand for `new FileBaselineStorage(configDir).locator(env, handle)` —
 * kept exported because earlier callers + tests reach for the path
 * directly to e.g. delete the file as a baseline reset.
 */
export const baselineFilePath = (
  configDir: string,
  envName: string,
  recipeHandle: string
): string => new FileBaselineStorage(configDir).locator(envName, recipeHandle);

/**
 * Load a recipe's baseline via the default file-backed storage.
 * Equivalent to `new FileBaselineStorage(configDir).load(env, handle)`;
 * kept as a thin function for callsite ergonomics + because the existing
 * code paths reach for `loadBaseline` directly. Future storage backends
 * accept a custom `BaselineStorage` instance through the planner +
 * push-task options instead.
 */
export const loadBaseline = (
  configDir: string,
  envName: string,
  recipeHandle: string
): Promise<Baseline | null> => new FileBaselineStorage(configDir).load(envName, recipeHandle);

/**
 * Write a recipe's baseline via the default file-backed storage. The
 * baseline replaces any existing one wholesale — see `BaselineStorage`
 * JSDoc. `capturedAt` is the caller's job so the value is deterministic
 * for tests; production stamps `new Date().toISOString()`.
 */
export const writeBaseline = (
  configDir: string,
  envName: string,
  recipeHandle: string,
  fields: readonly BaselineFieldEntry[],
  capturedAt: string
): Promise<string> => {
  const baseline: Baseline = {
    schemaVersion: "1",
    recipeHandle,
    envName,
    capturedAt,
    fields: [...fields],
  };
  return new FileBaselineStorage(configDir).write(envName, recipeHandle, baseline);
};

// ───────────────────────────────────────────────────────────────────────────
// Sync-storage bridge — single backing store across every recipe kind
// ───────────────────────────────────────────────────────────────────────────

/**
 * Wrap a multi-kind sync `BaselineStorage` (e.g. `HttpBaselineStorage`)
 * so it satisfies the content-recipe 2-arg `BaselineStorage` surface.
 * `kind` is pinned to `CONTENT_RECIPE_BASELINE_KIND`; the recipe `Baseline`
 * shape becomes the `payload` of a multi-kind envelope on write, and
 * is unwrapped from the envelope on load.
 *
 * Use this to let one orchestrator-side backing store serve content
 * recipes alongside brand / brief / campaign / story baselines —
 * push/pull don't change shape; only the storage they're wired with does.
 */
export const adaptSyncBaselineStorage = (
  sync: import("@/sync").BaselineStorage
): BaselineStorage => ({
  load: async (envName, recipeHandle) => {
    const envelope = await sync.load<Baseline>(CONTENT_RECIPE_BASELINE_KIND, envName, recipeHandle);
    return envelope ? envelope.payload : null;
  },
  write: (envName, recipeHandle, baseline) =>
    sync.write<Baseline>(CONTENT_RECIPE_BASELINE_KIND, envName, recipeHandle, {
      envelopeVersion: "1",
      kind: CONTENT_RECIPE_BASELINE_KIND,
      recipeHandle,
      envName,
      capturedAt: baseline.capturedAt,
      payload: baseline,
    }),
  locator: (envName, recipeHandle) =>
    sync.locator(CONTENT_RECIPE_BASELINE_KIND, envName, recipeHandle),
});
