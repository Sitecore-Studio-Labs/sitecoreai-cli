import { LAYOUT_FIELDS } from "../ir/sitecore-templates";
import type { OperationIr } from "../ir/operations";
import { classifyPullField } from "../runtime/merge";
import type {
  ComponentTemplateRecipeParsed,
  ContentFieldValue,
  ContentItemRecipeParsed,
  ContentTemplateRecipeParsed,
  ContentTranslation,
  ContentVersion,
  FieldDefinition,
  Layout,
  PageRecipeParsed,
  PageTemplateRecipeParsed,
} from "../schema/recipe";

/** Per-recipe merge classification (see runRecipePull JSDoc). */
export type RecipeMergeStatus =
  "in-sync" | "disk-ahead" | "tenant-edited" | "conflict" | "disk-only" | "tenant-only";

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
  // Per-field classify via the shared three-way core, then roll up. Keeps
  // the per-recipe verdict and the per-field map (`perFieldStatuses`)
  // derived from a single classification rule.
  return rollupPerFieldStatuses(perFieldStatuses(diskHashes, tenantHashes, baselineHashes));
};

/** One per-field classification — same domain as the per-recipe rollup. */
export type FieldMergeStatus = "in-sync" | "disk-ahead" | "tenant-edited" | "conflict";

/**
 * Convert an internal baselineLookupKey (`itemref|name:foo|lang|version`)
 * to a human-readable label for CLI output. Drops the itemRefKey segment
 * (always the same per recipe) and renders `(lang, v#)` only when set.
 */
export const humanizeFieldKey = (key: string): string => {
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
    out.set(
      key,
      classifyPullField(diskHashes?.get(key), tenantHashes?.get(key), baselineHashes?.get(key))
    );
  }
  return out;
};

/**
 * Roll up per-field statuses into a single per-recipe status. Mirrors
 * the legacy `classifyMergeStatus` behaviour for the per-recipe summary
 * (now derived from the same per-field map so the two views stay
 * consistent).
 */
export const rollupPerFieldStatuses = (
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

/** Same baselineLookupKey shape as baseline.ts / indexHashes. */
const fieldKey = (
  itemRefKey: string,
  fieldName: string,
  language?: string,
  version?: number
): string =>
  `${itemRefKey.toLowerCase()}|name:${fieldName.toLowerCase()}|${language ?? ""}|${version ?? ""}`;

/**
 * Pick the winning layout for one cell and write it onto `target.layout`
 * (or delete the key). When neither side carries a layout, leaves the
 * target untouched. `choose()` is evaluated lazily — only when at least
 * one side has a layout to merge — so we don't compute a winner for a
 * cell that has no layout at all. Shared by the per-version merge and the
 * page item-level merge.
 */
const applyLayoutPick = (
  target: { layout?: Layout },
  diskLayout: Layout | undefined,
  tenantLayout: Layout | undefined,
  choose: () => "disk" | "tenant"
): void => {
  if (diskLayout === undefined && tenantLayout === undefined) return;
  const layout = choose() === "disk" ? (diskLayout ?? tenantLayout) : (tenantLayout ?? diskLayout);
  if (layout !== undefined) target.layout = layout;
  else delete target.layout;
};

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
  diskRecipe: ContentItemRecipeParsed | PageRecipeParsed,
  tenantRecipe: ContentItemRecipeParsed | PageRecipeParsed,
  statuses: PerFieldStatuses,
  mainItemRefKey: string | undefined,
  /**
   * Optional per-(rawKey) override for the winner decision. Operator-set
   * via the merge-plan file (`--apply-plan`). When a key is present in
   * the overrides map, its value is used directly; missing keys fall
   * through to the default `disk-ahead → disk, else → tenant` policy.
   */
  winnerOverrides?: Map<string, "disk" | "tenant">
): ContentItemRecipeParsed | PageRecipeParsed => {
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
  const merged = { ...tenantRecipe } as ContentItemRecipeParsed | PageRecipeParsed;

  // Simple-mode default-language fields (DEFAULT_LANGUAGE = "en",
  // DEFAULT_VERSION = 1). compileContentItemRecipe / compilePageRecipe
  // emit these at (en, 1), so we look up per-field statuses at the
  // same coordinates.
  const DEFAULT_LANGUAGE = "en";
  const DEFAULT_VERSION = 1;
  // `PageRecipe.fields` is `Record<string, unknown>` (loose registry shape
  // alongside scai-native ContentFieldValue) — cast for the merge, which
  // is a structural pass-through that doesn't inspect the value's shape.
  merged.fields = mergeFieldMap(
    diskRecipe.fields as Record<string, ContentFieldValue>,
    tenantRecipe.fields as Record<string, ContentFieldValue>,
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

  // Merge one (lang, version) entry: per-field merge + per-cell layout pick.
  const mergeVersionEntry = (
    lang: string,
    versionN: number,
    dEntry: ContentVersion | undefined,
    tEntry: ContentVersion | undefined
  ): ContentVersion => {
    // Base preserves per-version metadata (workflowState, date) from the
    // tenant when present; falls back to disk only when the tenant lacks
    // the version (disk-only at the version level).
    const base = tEntry ?? dEntry!;
    const entry: ContentVersion = {
      ...base,
      fields: mergeFieldMap(dEntry?.fields, tEntry?.fields, lang, versionN),
    };
    // Layout merge: classify the per-(lang, version) `__Final Renderings`
    // cell via the canonical-XML baseline hash, and pick the disk-side
    // layout only when it's `disk-ahead`. Both sides may carry a layout —
    // when neither does, the field is omitted entirely.
    applyLayoutPick(entry, dEntry?.layout, tEntry?.layout, () => layoutWinner(lang, versionN));
    return entry;
  };

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
      mergedVersions[lang] = sorted.map((versionN) =>
        mergeVersionEntry(
          lang,
          versionN,
          diskEntries.find((e) => e.version === versionN),
          tenantEntries.find((e) => e.version === versionN)
        )
      );
    }
    merged.versions = mergedVersions;
  }

  // Page item-level layout (simple mode) — the compiler writes the same
  // layout to every populated (lang, 1) cell, so checking the primary
  // (DEFAULT_LANGUAGE, DEFAULT_VERSION) cell is representative. Only
  // applies to PageRecipe; ContentItemRecipe doesn't carry an
  // item-level layout.
  if (diskRecipe.kind === "page" && tenantRecipe.kind === "page") {
    applyLayoutPick(
      merged as PageRecipeParsed,
      (diskRecipe as PageRecipeParsed).layout,
      (tenantRecipe as PageRecipeParsed).layout,
      () => layoutWinner(DEFAULT_LANGUAGE, DEFAULT_VERSION)
    );
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
export const mergeTemplateRecipe = ({
  diskRecipe,
  tenantRecipe,
  statuses,
  diskIr,
  tenantIr,
  winnerOverrides,
}: {
  diskRecipe:
    ComponentTemplateRecipeParsed | ContentTemplateRecipeParsed | PageTemplateRecipeParsed;
  tenantRecipe:
    ComponentTemplateRecipeParsed | ContentTemplateRecipeParsed | PageTemplateRecipeParsed;
  statuses: PerFieldStatuses;
  diskIr: OperationIr;
  tenantIr: OperationIr;
  /** Per-(rawKey) override for the winner decision (merge-plan file). */
  winnerOverrides?: Map<string, "disk" | "tenant">;
}): ComponentTemplateRecipeParsed | ContentTemplateRecipeParsed | PageTemplateRecipeParsed => {
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
    ComponentTemplateRecipeParsed | ContentTemplateRecipeParsed | PageTemplateRecipeParsed;

  merged.fields = mergeFieldList(diskRecipe.fields, tenantRecipe.fields, "fields");

  if (diskRecipe.kind === "component-template" && tenantRecipe.kind === "component-template") {
    const diskComponent = diskRecipe as ComponentTemplateRecipeParsed;
    const tenantComponent = tenantRecipe as ComponentTemplateRecipeParsed;
    if (
      (diskComponent.params && diskComponent.params.length > 0) ||
      (tenantComponent.params && tenantComponent.params.length > 0)
    ) {
      (merged as ComponentTemplateRecipeParsed).params = mergeFieldList(
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
export const rollupTemplateStatuses = (
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
