import { createScaiError } from "@/shared/errors";
import type {
  AddItemVersionOp,
  AppendToMultiListOp,
  CreateItemOp,
  CreateSiteFromTemplateOp,
  FieldValue,
  MediaUploadOp,
  Operation,
  OperationIr,
  PruneChildrenOp,
  PushPolicy,
  RefValue,
  SetBaseTemplatesOp,
  SetFieldOp,
  SetStandardValuesOp,
} from "../ir/operations";
import { LAYOUT_FIELDS, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { SCAI_HANDLE_FIELD_NAME } from "../items/marker";
import { templatePathRefKey } from "../items/guids";
import { dashifyGuid, renderRefValue, resolveRecipeRefs } from "../api/ref-encoding";
import {
  layoutXmlEquivalent,
  layoutXmlEquivalentFromParsed,
  parseLayoutXml,
  type ParsedLayout,
} from "../layout/parse";
import type {
  AuthoringApiClient,
  CreateItemInput,
  ItemSelector,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "../api/client";
import type { NewSiteInput, SitesApiClient } from "../api/sites-client";
import { hashFieldValueForBaseline, type BaselineIndex } from "./baseline";
import { classifyPushDrift } from "./merge";

/**
 * `scai provision recipe plan` and `scai provision recipe push` share this read-then-diff path:
 *
 *   for each op:
 *     resolve the target item (path-based for CreateItem, captured-id
 *       based for update-style ops)
 *     read remote state; diff against IR
 *     emit mutation per policy (create / update / skip / error)
 *
 * Sitecore's Authoring API server-assigns itemIds on `createItem`. The
 * IR carries deterministic uuidv5 refKeys (recipe-internal) plus
 * Sitecore paths (deterministic from recipe + envProfile roots). On each
 * push, the executor maintains a per-run `capturedItemIds: Map<refKey,
 * sitecoreItemId>` populated from `getItem(by path)` and `createItem`
 * responses. Subsequent ops resolve their target by refKey → captured
 * itemId, and `ref-recipe` field values resolve through the same map.
 */

export interface FieldDiffEntry {
  fieldId: string;
  before: string | null;
  after: string;
  language?: string;
  version?: number;
  /**
   * Three-way merge classification for this field (only set when a
   * baseline is loaded — see `PlanOptions.baselineIndex`):
   *
   *   - "first-push" — no baseline entry; planner can't classify.
   *   - "recipe-change" — tenant matches baseline; recipe-wins is safe.
   *   - "cms-edit" — tenant differs from baseline, recipe matches baseline;
   *                  author edited via the Sitecore UI after the last push.
   *   - "conflict" — tenant differs from baseline AND recipe differs from
   *                  baseline; both sides moved.
   *
   * `undefined` when the planner ran without a baseline (legacy two-way
   * diff, current default until operators opt in).
   */
  classification?: "first-push" | "recipe-change" | "cms-edit" | "conflict";
}

/**
 * `"conflict"` is the new three-way-merge status: tenant disagrees with
 * recipe AND with baseline (both sides moved since last apply). The
 * `--conflict-policy` flag governs whether conflicts become `error`
 * (default), `update` (recipe-wins clobber), or `skip` (cms-wins preserve).
 */
type ActionStatus = "create" | "update" | "skip" | "error" | "prune" | "conflict";

/**
 * Recursive snapshot of a pruned item, captured at plan time so the
 * rollback module can recreate the subtree via `createItem` +
 * `addItemVersion` + `updateItem` if the surrounding push aborts.
 *
 * Tree shape: `children` is itself `PrunedItemSnapshot[]`, populated by
 * a depth-first walk of `getChildren` in `planPruneChildren`. Restoration
 * is depth-first as well — the parent's freshly-assigned itemId becomes
 * each child's parent on its inverse `createItem` call.
 *
 * Field shape splits shared from versioned:
 *  - `sharedFields` — fields with no `language` and no `version`; apply
 *    to every (language, version) of the item.
 *  - `versions` — one entry per (language, version) the item has at
 *    snapshot time, carrying that version's versioned-field values.
 *
 * Multi-language and multi-version are both captured: planPruneChildren
 * iterates each language in the operator-configured `snapshotLanguages`
 * list, enumerates that language's version stack via `getItemVersions`,
 * then per-version reads the item's fields via
 * `getItem(selector, { language, version })`. The cost scales as
 * O(N_pruned * L_languages * V_versions) getItem calls.
 *
 * Remaining lossy bound: **itemIds change on recreation.** Sitecore
 * assigns itemIds server-side on `createItem` and the Authoring API has
 * no input for preserving the original GUID. Inbound references to the
 * old GUID stay broken. Truly GUID-preserving rollback would need the
 * Content Serialization API, which scai does not adopt.
 */
export interface PrunedItemSnapshot {
  itemId: string;
  path: string;
  templateId: string;
  name: string;
  parentId: string;
  /**
   * Fields with no language/version — apply to every version of the
   * item. Captured once (deduped across the per-version reads).
   */
  sharedFields: RemoteFieldValue[];
  /**
   * Per-(language, version) versioned field snapshots. Ordered by
   * (language order from snapshotLanguages, then version ascending).
   * The first entry's language is used as the inverse `createItem`'s
   * `language` parameter.
   *
   * Versioned fields here include the field's own `language` and
   * `version` so the inverse path can write them via `updateItem`
   * scoped to the matching (language, version).
   */
  versions: Array<{
    language: string;
    version: number;
    fields: RemoteFieldValue[];
  }>;
  /**
   * Depth-first snapshot of this item's descendants. Empty when the
   * item is a leaf at snapshot time. The depth of the snapshot tree
   * matches the depth of the live subtree under the prune target.
   */
  children: PrunedItemSnapshot[];
}

export interface PlannedAction {
  index: number;
  operation: Operation;
  status: ActionStatus;
  reason?: string;
  diff?: FieldDiffEntry[];
  /** Snapshot of the mutation the executor will/would dispatch. */
  mutation?:
    | { kind: "createItem"; input: CreateItemInput }
    | { kind: "updateItem"; input: UpdateItemInput }
    | {
        kind: "createSite";
        input: NewSiteInput;
        /**
         * RefKey of the site item — the executor stores the
         * server-assigned site itemId here in `capturedItemIds` so
         * subsequent SetField ops scoped to the site (dictionary
         * overrides etc.) can resolve.
         */
        siteRefKey: string;
        /**
         * Environment languages to ensure (idempotently add) BEFORE
         * createSite: the site's primary `language` plus any
         * `additionalLanguages`. createSite fails when its `language`
         * isn't already on the environment; adding them also makes them
         * available environment-wide (e.g. to the brand-kit Glossary's
         * org locales).
         */
        languages: string[];
      }
    | {
        kind: "addItemVersion";
        /** Sitecore itemId of the target item. */
        itemId: string;
        /** Language whose numbered-version stack to extend. */
        language: string;
        /** How many versions to add to reach the op's declared `version`. */
        addCount: number;
      }
    | {
        kind: "mediaUpload";
        /** Resolved media-library-relative path (no `/sitecore/media library/` prefix). */
        itemPath: string;
        /** Source bytes the executor will POST to Sitecore's presigned URL. */
        bytes: Uint8Array;
        /** MIME type for the multipart form. */
        mimeType: string;
        /** Optional file name surfaced in the multipart form `file` part. */
        fileName?: string;
        /** Optional alt text applied to the resulting media item. */
        altText?: string;
        /**
         * RefKey of the MediaUpload op — the executor stamps the
         * server-assigned media item GUID under this key in
         * `capturedItemIds`, so subsequent SetField ops with a
         * `media-xml-ref` value resolve.
         */
        mediaRefKey: string;
      }
    | {
        kind: "pruneChildren";
        /**
         * Sitecore itemIds the apply phase would delete when `mode` is
         * `"delete"` and the operator passed `--allow-prune`. Always
         * populated (possibly empty in degenerate cases — those should
         * status `skip`, not surface here).
         */
        itemIds: string[];
        /**
         * `"warn"` — apply skips the actual delete and the prune list
         * surfaces in the log for rehearsal. `"delete"` — apply removes
         * the items (gated additionally by `--allow-prune` at the
         * executor layer; the IR-level mode and the CLI flag are
         * independent consent layers).
         */
        mode: "warn" | "delete";
      };
  /**
   * Per-child plan-display data for PruneChildren actions — the path and
   * template of each item the prune would (or did) remove. Used by the
   * `recipe plan` renderer so operators see exactly which items are at
   * risk before they pass `--allow-prune`.
   *
   * Also carries the full pre-delete snapshot used by the rollback
   * module to recreate items via `createItem` + `addItemVersion` +
   * `updateItem` if the surrounding push aborts. Each entry is a
   * recursive tree node (`children` is itself `PrunedItemSnapshot[]`)
   * so a pruned subtree restores depth-first — direct children of the
   * prune target, AND their descendants, are all snapshotted at plan
   * time. Each node captures the full (language, version) field grid
   * for every language in the push's `snapshotLanguages` config (each
   * language → all numbered versions → fields per version).
   *
   * The single remaining lossy bound is bounded by the Authoring API
   * surface scai uses:
   *  - **itemIds are fresh on recreation.** Sitecore assigns itemIds
   *    server-side on `createItem`; the API has no input for preserving
   *    the original GUID. Inbound references (multi-list values, layout
   *    `<r id />` GUIDs, link fields) that pointed at the old GUID stay
   *    broken after restoration. Truly GUID-preserving rollback would
   *    need the Content Serialization API (a separate REST surface
   *    scai does not adopt).
   */
  prunedItems?: PrunedItemSnapshot[];
  /**
   * Per-multi-list plan-display data for AppendToMultiList actions whose
   * `appendPolicy` is `"replace"`. Empty arrays when nothing changed.
   * `merge-unique` ops do not populate this — `diff` already captures
   * the before/after pipe-list.
   */
  replacedListValues?: { added: string[]; removed: string[] };
  /**
   * Pre-mutation remote state captured during plan-time read. `null` means
   * the target item did not exist at plan time. Used by rollback to
   * derive inverse mutations.
   */
  snapshot?: RemoteItem | null;
}

export interface PlanSummary {
  create: number;
  update: number;
  skip: number;
  error: number;
  /**
   * Count of PruneChildren actions that emitted a non-empty delete list.
   * Independent of mode — both `"warn"` (rehearsal) and `"delete"`
   * (executable) contribute, because both surface a prune list the
   * operator must reckon with before the next push.
   */
  prune: number;
  /**
   * Count of actions blocked by three-way merge conflict detection —
   * the recipe would clobber an author edit (and `--conflict-policy`
   * was the default `error`). Non-zero means apply is blocked for at
   * least one op in the recipe; the operator must reconcile or pick a
   * non-default policy. Always 0 when the planner ran without a
   * baseline.
   */
  conflict: number;
}

export interface Plan {
  schemaVersion: "1";
  recipeHandle: string;
  actions: PlannedAction[];
  summary: PlanSummary;
}

export type PlanEvent =
  | { kind: "op-start"; index: number; operation: Operation }
  | { kind: "op-result"; action: PlannedAction }
  | { kind: "op-error"; index: number; operation: Operation; error: string };

export interface PlanOptions {
  emit?: (event: PlanEvent) => void;
  /**
   * Per-run map from recipe-internal refKey (uuidv5) to Sitecore-assigned
   * itemId. The executor passes a shared map and updates it as creates
   * resolve. Plan mode passes a fresh map; refs that don't resolve
   * during plan-mode produce `skip` actions.
   */
  capturedItemIds?: Map<string, string>;
  /**
   * Sites API client — only consulted when an IR contains
   * `CreateSiteFromTemplate` ops. Recipe sets that don't include
   * SiteRecipes don't need a sites client; passing undefined is fine
   * and yields an `error` action only if a site op is encountered.
   */
  sitesClient?: SitesApiClient;
  /**
   * Workspace-wide path → RemoteItem snapshot cache. When provided,
   * `buildAction` consults it before issuing `client.getItem({ path })`
   * for CreateItem ops. Cache hits skip the wire call entirely.
   */
  pathSnapshotCache?: Map<string, RemoteItem | null>;
  /**
   * Workspace-wide path → itemId cache (shared with the AuthoringApiClient).
   * Threaded so `buildAction` can populate it after a successful read,
   * and so the planner sees same path resolutions a sibling recipe
   * already made earlier in the push.
   */
  pathItemIdCache?: Map<string, string>;
  /**
   * Operator override for which languages prune-rollback snapshots
   * capture per-(language, version) fields in. The first entry is
   * treated as the "default language" used by the rollback path's
   * inverse `createItem`.
   *
   * When **unset (undefined)**, the planner auto-discovers the tenant's
   * configured language set via `client.getTenantLanguages` (queries
   * the GraphQL root `languages { nodes { name } }` connection). The
   * XM Cloud Authoring schema doesn't expose item-level `Item.languages`
   * — the planner enumerates tenant languages and probes each per item
   * via `getItemVersions` to filter out the ones the item isn't
   * authored in. Schema unsupported / network failure → safely falls
   * back to `["en"]` (the client's catch block).
   *
   * When **explicitly set** (even to a single-language array), skips
   * auto-discovery and uses exactly the provided list — gives
   * operators a way to bound snapshot cost on tenants where discovery
   * would return languages they don't care to back up.
   */
  snapshotLanguages?: readonly string[];
  /**
   * Three-way merge baseline — the previous successful push's
   * per-field value hashes. When provided, `computeFieldDrift`
   * classifies each drift entry as `recipe-change`, `cms-edit`, or
   * `conflict` (see `FieldDiffEntry.classification`); ops whose desired
   * field write would clobber a `cms-edit` or `conflict` field route to
   * the new `"conflict"` status instead of `"update"`.
   *
   * Pass `undefined` (the default) or `indexBaseline(null)` for legacy
   * two-way-diff behaviour: every divergence is recipe-wins, no
   * conflict surface.
   */
  baselineIndex?: BaselineIndex;
  /**
   * How `"conflict"` actions resolve when downgraded to a concrete
   * mutation status:
   *
   *   - `"error"` (default) — keep status `"conflict"`. The executor
   *     refuses to apply; the operator must reconcile manually.
   *   - `"recipe-wins"` — downgrade to `"update"`, clobbering the
   *     author's edit. Matches the legacy two-way behaviour.
   *   - `"cms-wins"` — downgrade to `"skip"`, preserving the author's
   *     edit and dropping the recipe-side change for this push.
   *
   * The flag only matters when a baseline is loaded. Without one, every
   * drift surfaces as `"update"` regardless of policy.
   */
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
}

const lookupField = (
  remote: RemoteItem,
  fieldId: string,
  fieldName: string | undefined,
  language: string | undefined,
  version: number | undefined
): RemoteFieldValue | undefined =>
  remote.fields.find((f) => {
    // Match by name when the IR carries one — recipe-created field GUIDs
    // are IR-internal refKeys that don't match the tenant's actual GUIDs,
    // so name is the only reliable selector. Else match by GUID (system
    // fields' GUIDs are real Sitecore built-ins).
    const idMatches = fieldName
      ? f.name === fieldName
      : f.fieldId.toLowerCase() === fieldId.toLowerCase();
    return (
      idMatches &&
      // Sitecore Authoring GraphQL doesn't return per-field language/version
      // on the basic `Item.fields` query — `f.language`/`f.version` are
      // typically undefined. Match only when the recipe's filter is also
      // undefined or when the API DID return them (custom integrations).
      (language === undefined || f.language === undefined || f.language === language) &&
      (version === undefined || f.version === undefined || f.version === version)
    );
  });

/** Resolve every recipe-ref / source-prefix in a field value list. */
const resolveAll = (
  fields: FieldValue[],
  capturedItemIds: ReadonlyMap<string, string>
): FieldValue[] =>
  fields.map((field) => ({
    ...field,
    value: resolveRecipeRefs(field.value, capturedItemIds),
  }));

/**
 * Build an `UpdateItemInput`, lifting a uniform field `language` / `version`
 * to the input level. The Authoring API writes every `FieldValueInput` at
 * the input's language/version — per-field language/version is not on the
 * wire — so a `SetField` targeting a non-default language or a story-seed
 * numbered version must surface it here. When the fields disagree (or carry
 * none) the level is left unset and the write lands on the item's default
 * language / latest version.
 */
const toUpdateItemInput = (itemId: string, fields: FieldValue[]): UpdateItemInput => {
  const input: UpdateItemInput = { itemId, fields };
  const languages = new Set(fields.map((field) => field.language));
  if (languages.size === 1 && fields[0]?.language !== undefined) {
    input.language = fields[0].language;
  }
  const versions = new Set(fields.map((field) => field.version));
  if (versions.size === 1 && fields[0]?.version !== undefined) {
    input.version = fields[0].version;
  }
  return input;
};

/**
 * Classify a single drift entry against the baseline (three-way merge).
 * Returns `undefined` when no baseline is loaded — the caller leaves
 * `FieldDiffEntry.classification` unset and the legacy recipe-wins
 * behaviour applies.
 *
 * Layout fields (`__Renderings` / `__Final Renderings`) classify the
 * same way as plain fields — the baseline hash for them uses
 * `hashFieldValueForBaseline`, which parses the XML through
 * `parseLayoutXml` and serialises to a deterministic JSON form before
 * hashing. That collapses canonical vs SXA-delta wire form differences
 * so push + read round-trip cleanly. `layoutXmlEquivalent` still
 * handles the "before/after" raw-XML structural compare for the diff
 * `before`/`after` strings.
 */
interface ClassifyAgainstBaselineOptions {
  itemRefKey: string | undefined;
  fieldId: string;
  fieldName: string | undefined;
  language: string | undefined;
  version: number | undefined;
  recipeHash: string;
  tenantHash: string;
  baselineIndex: BaselineIndex | undefined;
}

const classifyAgainstBaseline = ({
  itemRefKey,
  fieldId,
  fieldName,
  language,
  version,
  recipeHash,
  tenantHash,
  baselineIndex,
}: ClassifyAgainstBaselineOptions): FieldDiffEntry["classification"] | undefined => {
  if (!baselineIndex || itemRefKey === undefined) return undefined;
  // Delegate the actual recipe/tenant/baseline who-moved decision to the
  // shared three-way core (mirrors the pull-side `classifyPullField`).
  // This layer only owns the baseline lookup + the no-baseline guard.
  const baselineHash = baselineIndex.lookup(itemRefKey, fieldId, fieldName, language, version);
  return classifyPushDrift(recipeHash, tenantHash, baselineHash);
};

const computeFieldDrift = (
  desired: FieldValue[],
  remote: RemoteItem,
  capturedItemIds: ReadonlyMap<string, string>,
  itemRefKey?: string,
  baselineIndex?: BaselineIndex
): FieldDiffEntry[] => {
  const drift: FieldDiffEntry[] = [];
  for (const field of desired) {
    const resolvedValue: RefValue = resolveRecipeRefs(field.value, capturedItemIds);
    const want = renderRefValue(resolvedValue);
    const found = lookupField(
      remote,
      field.fieldId,
      field.fieldName,
      field.language,
      field.version
    );
    if (!found) {
      drift.push({
        fieldId: field.fieldId,
        before: null,
        after: want,
        language: field.language,
        version: field.version,
        ...(baselineIndex && itemRefKey !== undefined
          ? {
              classification: classifyAgainstBaseline({
                itemRefKey,
                fieldId: field.fieldId,
                fieldName: field.fieldName,
                language: field.language,
                version: field.version,
                recipeHash: hashFieldValueForBaseline(field.fieldId, want),
                // No tenant value → distinct from any hash → forces
                // recipe-change vs first-push purely on baseline presence.
                tenantHash: "",
                baselineIndex,
              }),
            }
          : {}),
      });
      continue;
    }
    // Layout fields (`__Renderings` / `__Final Renderings`) carry XML
    // that Sitecore's layout pipeline normalises on write (canonical →
    // SXA delta, plus baseline `<p:da>` directives). A raw string
    // compare would report a phantom update on every re-push, so diff
    // them structurally — same placements ⇒ no drift.
    //
    // Performance: parse each side ONCE per drift, then reuse the
    // parsed values for both the equivalence check AND the canonical
    // hash. Without dedup the drift path parses each value twice
    // (once in `layoutXmlEquivalent`, once in
    // `hashFieldValueForBaseline → canonicaliseLayoutXml`); for
    // multi-lang/multi-version Pages with many layout cells that 4×
    // parse cost compounded.
    const isLayoutField =
      field.fieldId === LAYOUT_FIELDS.RENDERINGS ||
      field.fieldId === LAYOUT_FIELDS.FINAL_RENDERINGS;
    let wantParsed: ParsedLayout | undefined;
    let foundParsed: ParsedLayout | undefined;
    if (isLayoutField) {
      try {
        wantParsed = parseLayoutXml(want);
        foundParsed = parseLayoutXml(found.value);
      } catch {
        // One side failed to parse — fall back to the slower path,
        // which itself catches + degrades to string equality.
      }
    }
    const equal = isLayoutField
      ? wantParsed && foundParsed
        ? layoutXmlEquivalentFromParsed(wantParsed, foundParsed)
        : layoutXmlEquivalent(found.value, want)
      : found.value === want;
    if (!equal) {
      const classification = classifyAgainstBaseline({
        itemRefKey,
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        language: field.language,
        version: field.version,
        recipeHash: hashFieldValueForBaseline(field.fieldId, want, wantParsed),
        tenantHash: hashFieldValueForBaseline(field.fieldId, found.value, foundParsed),
        baselineIndex,
      });
      drift.push({
        fieldId: field.fieldId,
        before: found.value,
        after: want,
        language: field.language,
        version: field.version,
        ...(classification !== undefined && { classification }),
      });
    }
  }
  return drift;
};

/**
 * Reduce a drift array (with optional baseline classifications) to a
 * resolved status under the given conflict policy.
 *
 *   - No drift → `null` (caller emits the existing `"skip"` action).
 *   - No baseline → legacy `"update"` regardless of policy.
 *   - All drift is `recipe-change` or `first-push` → safe `"update"`.
 *   - Any drift is `conflict` → applies the policy:
 *       error → `"conflict"`; recipe-wins → `"update"`; cms-wins → `"skip"`.
 *   - Otherwise drift contains `cms-edit` (but no `conflict`):
 *       error → `"conflict"`; recipe-wins → `"update"`; cms-wins → `"skip"`.
 *     `cms-edit` flips to `"conflict"` under default policy because
 *     applying the recipe value WOULD overwrite the author's edit —
 *     even though the recipe value matches the baseline. (The recipe
 *     didn't change, but the tenant did; the operator should know.)
 *
 * The caller still owns mutation construction; this helper is purely
 * the status reducer.
 */
const resolveConflictStatus = (
  drift: FieldDiffEntry[],
  conflictPolicy: PlanOptions["conflictPolicy"]
): { status: "update" | "conflict" | "skip"; reason?: string } => {
  const classifications = drift
    .map((d) => d.classification)
    .filter((c): c is NonNullable<FieldDiffEntry["classification"]> => c !== undefined);
  if (classifications.length === 0) {
    // No baseline classifications → legacy behaviour: every drift is
    // recipe-wins update.
    return { status: "update" };
  }
  const hasConflict = classifications.includes("conflict");
  const hasCmsEdit = classifications.includes("cms-edit");
  if (!hasConflict && !hasCmsEdit) {
    return { status: "update" };
  }
  const policy = conflictPolicy ?? "error";
  if (policy === "recipe-wins") {
    return {
      status: "update",
      reason: hasConflict
        ? "conflict resolved as recipe-wins (clobbering author edit AND recipe change)"
        : "cms-edit overridden as recipe-wins (clobbering author edit)",
    };
  }
  if (policy === "cms-wins") {
    return {
      status: "skip",
      reason: hasConflict
        ? "conflict resolved as cms-wins (preserving author edit; recipe change dropped)"
        : "cms-edit preserved as cms-wins (recipe value matches baseline; tenant ahead)",
    };
  }
  return {
    status: "conflict",
    reason: hasConflict
      ? "conflict: tenant and recipe both diverged from baseline — pass --conflict-policy=recipe-wins or =cms-wins to resolve"
      : "cms-edit: author edited tenant after last push; recipe would clobber. Pass --conflict-policy=recipe-wins or =cms-wins to resolve",
  };
};

/**
 * Resolve a CreateItem op's parent ref to a Sitecore itemId.
 *
 * Sitecore's `createItem` requires `parent: ID!` (a GUID). Path-only
 * parents (`ref-path`) are looked up via `getItem({ path })` and cached
 * in `capturedItemIds` keyed by the path string itself. Recipe-internal
 * `ref-recipe` parents resolve via the same map keyed by their refKey,
 * populated as parent ops apply.
 *
 * Returns `unresolvedRefKey` only when a `ref-recipe` parent's CreateItem
 * has not yet captured an itemId (plan-mode against an empty tenant
 * before applies happen).
 */
const resolveCreateItemParent = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): { resolved: string } | { unresolvedRefKey: string } => {
  if (op.parent.kind === "ref-path") {
    const cached = capturedItemIds.get(op.parent.value);
    if (cached) return { resolved: cached };
    // Plan-mode fallback when the path lookup returned null (tenant
    // doesn't have it yet, or we're testing without a live tenant).
    return { resolved: op.parent.value };
  }
  const itemId = capturedItemIds.get(op.parent.refKey);
  if (itemId) {
    return { resolved: itemId };
  }
  // Plan-mode preview fallback: when the parent's CreateItem hasn't run
  // yet (captured map empty), derive the parent path from op.path. Apply-
  // mode normally fills the captured map before children dispatch, so this
  // branch is mostly for `recipe plan` output.
  const trail = `/${op.name}`;
  if (op.path.endsWith(trail)) {
    const parentPath = op.path.slice(0, -trail.length);
    if (parentPath) {
      return { resolved: parentPath };
    }
  }
  return { unresolvedRefKey: op.parent.refKey };
};

/**
 * Strict variant of parent resolution for the plan-time sibling-name
 * fallback. Unlike `resolveCreateItemParent` (which has plan-mode-friendly
 * path-string fallbacks), this returns an itemId ONLY when one is
 * actually in the captured map — so the caller can safely pass the
 * result to `getChildren({ itemId })` without risk of feeding it a path.
 */
const resolveParentItemIdForFallback = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): string | null => {
  const candidate =
    op.parent.kind === "ref-path"
      ? capturedItemIds.get(op.parent.value)
      : capturedItemIds.get(op.parent.refKey);
  if (!candidate) return null;
  if (candidate.startsWith("/")) return null;
  return candidate;
};

/**
 * Sibling fallback for a CreateItem whose path lookup returned null —
 * find the live item the planner would otherwise duplicate. Two cases:
 *
 *   1. Path-index lag — a repeat push within the index-propagation window
 *      sees `getItem({path})` return null for a path the tenant has. A
 *      name match among the parent's children is the lag-immune fix.
 *   2. Rename — a CMS user renamed the item, so neither path nor sibling
 *      NAME matches. The `Scai Handle` marker survives a rename. The
 *      marker carries the *recipe* handle (shared across siblings one
 *      recipe creates), so the match is trusted only when exactly one
 *      sibling carries it; >1 falls through to no match, never risking a
 *      wrong rebind.
 *
 * Returns `null` when the parent itemId isn't known yet (true first push)
 * or no sibling matches — the caller then plans a create as normal.
 */
const findCreateItemSibling = async (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>,
  client: AuthoringApiClient
): Promise<RemoteItem | null> => {
  const parentItemId = resolveParentItemIdForFallback(op, capturedItemIds);
  if (!parentItemId) return null;
  const siblings = await client.getChildren({ itemId: parentItemId });
  const byName = siblings.find((s) => s.name === op.name);
  if (byName) return byName;
  const handle = opHandleMarker(op);
  if (handle === undefined) return null;
  const marked = siblings.filter((s) => remoteHandleMarker(s) === handle);
  return marked.length === 1 ? marked[0] : null;
};

/**
 * The `Scai Handle` recipe-identity marker `injectHandleMarker` stamped on a
 * CreateItem op, or `undefined` for an op that carries none (e.g. an IR that
 * never went through `injectHandleMarker`).
 */
const opHandleMarker = (op: CreateItemOp): string | undefined => {
  const field = op.fields.find(
    (f) => (f.fieldName ?? "").toLowerCase() === SCAI_HANDLE_FIELD_NAME.toLowerCase()
  );
  return field && field.value.kind === "string" ? field.value.value : undefined;
};

/** The `Scai Handle` marker value on a live item, or `undefined` when unmarked. */
const remoteHandleMarker = (item: RemoteItem): string | undefined =>
  item.fields.find((f) => (f.name ?? "").toLowerCase() === SCAI_HANDLE_FIELD_NAME.toLowerCase())
    ?.value;

/**
 * Resolve a CreateItem op's templateOf to a Sitecore item ID.
 *
 *   - String form: usually a constant Sitecore built-in GUID. If it
 *     matches a refKey captured during this push (e.g. SV item under
 *     a recipe-created template), resolve to the captured itemId.
 *   - `{kind: "ref-path"}` form: late-resolved against a content-tree
 *     path. The push pipeline seeds `crossRecipeRefs[templatePathRefKey(path)] = path`;
 *     the executor's `getItemsByPaths` batch lookup populates
 *     `capturedItemIds` before planning starts. A miss here means the
 *     template item doesn't exist on the tenant — planner skips with a
 *     clear reason rather than letting the upstream createItem throw.
 */
const resolveTemplateOf = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): { resolved: string } | { unresolvedRefKey: string; reason?: string } => {
  if (typeof op.templateOf === "string") {
    // If templateOf matches a refKey in our captured map, resolve it.
    // Otherwise it's a known Sitecore built-in GUID and we use as-is.
    const captured = capturedItemIds.get(op.templateOf);
    if (captured) {
      return { resolved: captured };
    }
    // Known Sitecore built-in (Template, Section, Field, Folder, Rendering, etc.).
    return { resolved: op.templateOf };
  }
  // ref-path: resolve via the seed map.
  const refKey = templatePathRefKey(op.templateOf.value);
  const captured = capturedItemIds.get(refKey);
  if (captured) return { resolved: captured };
  return {
    unresolvedRefKey: refKey,
    reason: `templateOf path '${op.templateOf.value}' did not resolve. The template item is missing from the tenant or the path is wrong — verify the template exists.`,
  };
};

interface PlanCreateItemOptions {
  op: CreateItemOp;
  remote: RemoteItem | null;
  index: number;
  capturedItemIds: ReadonlyMap<string, string>;
  baselineIndex?: BaselineIndex;
  conflictPolicy?: PlanOptions["conflictPolicy"];
}

const planCreateItem = ({
  op,
  remote,
  index,
  capturedItemIds,
  baselineIndex,
  conflictPolicy,
}: PlanCreateItemOptions): PlannedAction => {
  if (!remote) {
    const parent = resolveCreateItemParent(op, capturedItemIds);
    if ("unresolvedRefKey" in parent) {
      return {
        index,
        operation: op,
        status: "skip",
        reason: `Parent ref ${parent.unresolvedRefKey} not yet captured (parent's CreateItem hasn't run).`,
      };
    }
    const tpl = resolveTemplateOf(op, capturedItemIds);
    if ("unresolvedRefKey" in tpl) {
      return {
        index,
        operation: op,
        status: "skip",
        reason: tpl.reason ?? `templateOf ref ${tpl.unresolvedRefKey} not yet captured.`,
      };
    }
    // Plan-mode preview tolerates unresolved field refs: we report status
    // create, but omit the mutation snapshot until apply-mode actually
    // captures the dependent itemIds. Apply-mode populates the captured
    // map as it goes, so by the time a child op runs its parents' refs
    // are present and resolveAll succeeds.
    let resolvedFields: FieldValue[];
    try {
      resolvedFields = resolveAll(op.fields, capturedItemIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        index,
        operation: op,
        status: "create",
        reason: `Plan preview: ${message}`,
      };
    }
    return {
      index,
      operation: op,
      status: "create",
      mutation: {
        kind: "createItem",
        input: {
          parent: parent.resolved,
          templateId: tpl.resolved,
          name: op.name,
          fields: resolvedFields,
          // The planner reads existence via the path index, which lags
          // writes by seconds-to-minutes. On a rapid second push the
          // planner can see "missing" and plan a create against a path
          // the tenant already has — request an authoritative
          // parent-children pre-check at apply time to prevent
          // duplicate-sibling creation (the root cause of the
          // `audit slug-conflicts` false positives after re-push).
          idempotencyCheck: true,
        },
      },
    };
  }
  if (op.policy === "CreateOnly") {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Item already exists and policy is CreateOnly.",
    };
  }
  const drift = computeFieldDrift(op.fields, remote, capturedItemIds, op.id, baselineIndex);
  if (drift.length === 0) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Item exists and all tracked fields match.",
    };
  }
  const driftedSet = new Set(
    drift.map((d) => `${d.fieldId}:${d.language ?? ""}:${d.version ?? ""}`)
  );
  const fieldsToSet = resolveAll(
    op.fields.filter((f) => driftedSet.has(`${f.fieldId}:${f.language ?? ""}:${f.version ?? ""}`)),
    capturedItemIds
  );
  const resolved = resolveConflictStatus(drift, conflictPolicy);
  if (resolved.status === "skip") {
    return {
      index,
      operation: op,
      status: "skip",
      reason: resolved.reason ?? "Conflict resolved as cms-wins.",
      diff: drift,
    };
  }
  if (resolved.status === "conflict") {
    return {
      index,
      operation: op,
      status: "conflict",
      reason: resolved.reason,
      diff: drift,
    };
  }
  return {
    index,
    operation: op,
    status: "update",
    diff: drift,
    ...(resolved.reason && { reason: resolved.reason }),
    mutation: {
      kind: "updateItem",
      input: toUpdateItemInput(remote.itemId, fieldsToSet),
    },
  };
};

interface PlanUpdateOpOptions {
  index: number;
  op: SetFieldOp | SetBaseTemplatesOp | SetStandardValuesOp;
  itemRefKey: string;
  desiredFields: FieldValue[];
  policy: PushPolicy;
  remote: RemoteItem | null;
  capturedItemIds: ReadonlyMap<string, string>;
  baselineIndex?: BaselineIndex;
  conflictPolicy?: PlanOptions["conflictPolicy"];
}

const planUpdateOp = ({
  index,
  op,
  itemRefKey,
  desiredFields,
  policy,
  remote,
  capturedItemIds,
  baselineIndex,
  conflictPolicy,
}: PlanUpdateOpOptions): PlannedAction => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${itemRefKey}) not yet captured/created.`,
    };
  }
  const drift = computeFieldDrift(
    desiredFields,
    remote,
    capturedItemIds,
    itemRefKey,
    baselineIndex
  );
  if (drift.length === 0) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Field already at desired value.",
    };
  }
  if (policy === "CreateOnly") {
    const allBlankBefore = drift.every((d) => d.before === null || d.before === "");
    if (!allBlankBefore) {
      return {
        index,
        operation: op,
        status: "skip",
        reason: "Field already set; CreateOnly policy preserves CMS edits.",
      };
    }
  }
  const resolved = resolveConflictStatus(drift, conflictPolicy);
  if (resolved.status === "skip") {
    return {
      index,
      operation: op,
      status: "skip",
      reason: resolved.reason ?? "Conflict resolved as cms-wins.",
      diff: drift,
    };
  }
  if (resolved.status === "conflict") {
    return {
      index,
      operation: op,
      status: "conflict",
      reason: resolved.reason,
      diff: drift,
    };
  }
  return {
    index,
    operation: op,
    status: "update",
    diff: drift,
    ...(resolved.reason && { reason: resolved.reason }),
    mutation: {
      kind: "updateItem",
      input: toUpdateItemInput(remote.itemId, resolveAll(desiredFields, capturedItemIds)),
    },
  };
};

const setFieldDesired = (op: SetFieldOp): FieldValue[] => [
  {
    fieldId: op.fieldId,
    fieldName: op.fieldName,
    language: op.language,
    version: op.version,
    value: op.value,
  },
];

const setBaseTemplatesDesired = (
  op: SetBaseTemplatesOp,
  effectiveBaseTemplates: readonly string[]
): FieldValue[] => [
  {
    fieldId: SYSTEM_FIELDS.BASE_TEMPLATE,
    value: { kind: "ref-guid-list", values: [...effectiveBaseTemplates] },
  },
];

/**
 * Resolve a SetBaseTemplates op's effective base list: the static
 * `baseTemplates` plus, per `pathBases` entry, either the live item found
 * at the tenant path or that entry's compile-time fallbacks. Deduped so
 * a fallback GUID that also appears statically isn't written twice.
 */
const resolveEffectiveBaseTemplates = async (
  op: SetBaseTemplatesOp,
  readByPath: (path: string) => Promise<RemoteItem | null>
): Promise<string[]> => {
  const effective: string[] = [...op.baseTemplates];
  for (const pathBase of op.pathBases ?? []) {
    const remote = await readByPath(pathBase.path);
    if (remote) {
      effective.push(normaliseGuid(remote.itemId));
    } else {
      effective.push(...pathBase.fallbackTemplates);
    }
  }
  return [...new Set(effective.map((guid) => guid.toLowerCase()))];
};

/** Lowercase, brace-less GUID — the shape `ref-guid-list` values carry. */
const normaliseGuid = (guid: string): string => guid.replace(/[{}]/g, "").toLowerCase();

const setStandardValuesDesired = (op: SetStandardValuesOp): FieldValue[] => [
  {
    fieldId: SYSTEM_FIELDS.STANDARD_VALUES,
    value: { kind: "ref-recipe", refKey: op.standardValuesRefKey },
  },
];

/**
 * Compute the lookup selector for a given op. CreateItem looks up by
 * path; update-style ops look up by the captured itemId for their target
 * refKey. Returns `null` when the captured map doesn't have the refKey
 * yet — that signals the planner to skip.
 */
const lookupSelector = (
  op: Operation,
  capturedItemIds: ReadonlyMap<string, string>
): ItemSelector | null => {
  if (op.op === "CreateItem") {
    return { path: op.path };
  }
  if (op.op === "CreateSiteFromTemplate") {
    // Site idempotency lookup goes through SitesApiClient.listSites, not
    // Authoring API getItem; planCreateSite handles the lookup itself.
    return null;
  }
  if (op.op === "MediaUpload") {
    // MediaUpload idempotency goes through a media-library lookup at
    // apply time (sub-milestone E); the planner has nothing to read up
    // front. Return null so the dispatch loop short-circuits to the
    // op-specific handler.
    return null;
  }
  let refKey: string;
  if (op.op === "SetField" || op.op === "SetBaseTemplates") {
    refKey = op.itemRefKey;
  } else if (op.op === "SetStandardValues") {
    refKey = op.templateRefKey;
  } else if (op.op === "PruneChildren") {
    // PruneChildren targets the parent container, not a field on it.
    // The planner only needs the parent's itemId so it can call
    // getChildren — there's no remote-state diff to read on the parent
    // itself, so the dispatch loop's later getItem call is incidental.
    refKey = op.parentRefKey;
  } else {
    // AppendToMultiList / AddItemVersion — target item keyed by itemRefKey.
    refKey = op.itemRefKey;
  }
  const itemId = capturedItemIds.get(refKey);
  return itemId ? { itemId } : null;
};

/**
 * Plan a single op against the current remote state. Exposed so the
 * executor's apply mode can interleave plan-and-apply per-op (each op's
 * plan sees the cascading effect of earlier ops' applies — required for
 * idempotency: a second push must see no drift on update-style ops whose
 * targets the first push created).
 *
 * Updates `capturedItemIds` when `getItem(by path)` finds an existing
 * item (so subsequent ops can resolve refs without dispatching).
 *
 * When a `pathSnapshotCache` is provided (workspace prefetch), each
 * `getItem({ path })` call short-circuits to the cached value when the
 * path is already known — `null` means "checked and missing", a
 * `RemoteItem` means "use this snapshot". Non-path lookups (by itemId)
 * still hit the wire.
 */
export interface BuildActionOptions {
  index: number;
  op: Operation;
  client: AuthoringApiClient;
  capturedItemIds: Map<string, string>;
  sitesClient?: SitesApiClient;
  pathSnapshotCache?: Map<string, RemoteItem | null>;
  /**
   * Operator override for prune-rollback snapshot languages. Forwarded
   * to `planPruneChildren`. Leave undefined to let the planner
   * auto-discover via `client.getTenantLanguages` once per push.
   */
  snapshotLanguages?: readonly string[];
  /**
   * Three-way merge baseline + conflict policy. Forwarded to
   * `planCreateItem` / `planUpdateOp` so per-field drift classifies as
   * `recipe-change` / `cms-edit` / `conflict` and routes per the policy.
   */
  baselineIndex?: BaselineIndex;
  conflictPolicy?: PlanOptions["conflictPolicy"];
  /**
   * RefKeys of items CREATED earlier in this push run (apply mode
   * tracks them across IRs). Update-style ops targeting one of these
   * bypass baseline classification entirely: a brand-new item cannot
   * carry CMS edits, so any divergence between its server-initialised
   * field values and a stale baseline (e.g. the same refKey's previous
   * item at an old path) is NOT an author edit — treating it as one
   * skipped the write and shipped items with default field values (the
   * page-template base-templates regression: relocated templates kept
   * Sitecore's default Standard-template-only inheritance because the
   * stale baseline classified the fresh item as a cms-edit/conflict).
   */
  createdThisRun?: ReadonlySet<string>;
}

export const buildAction = async ({
  index,
  op,
  client,
  capturedItemIds,
  sitesClient,
  pathSnapshotCache,
  snapshotLanguages,
  baselineIndex,
  conflictPolicy,
  createdThisRun,
}: BuildActionOptions): Promise<PlannedAction> => {
  // Baseline classification only applies to PRE-EXISTING items — an
  // item created earlier in this run has no CMS history to preserve
  // (see `createdThisRun` on BuildActionOptions).
  const baselineFor = (targetRefKey: string): BaselineIndex | undefined =>
    createdThisRun?.has(targetRefKey) ? undefined : baselineIndex;
  const cachedReadByPath = async (path: string): Promise<RemoteItem | null> => {
    if (pathSnapshotCache?.has(path)) {
      return pathSnapshotCache.get(path) ?? null;
    }
    const remote = await client.getItem({ path });
    pathSnapshotCache?.set(path, remote);
    return remote;
  };

  // Late-path resolution: SetField ops whose target is materialised
  // mid-push (e.g. dictionary phrases under a CreateSiteFromTemplate)
  // carry an optional `latePath`. If the op's itemRefKey isn't yet in
  // the captured map AND a latePath is set, do an on-demand getItem
  // lookup to seed the map BEFORE lookupSelector runs. Without this,
  // lookupSelector sees no captured itemId and the SetField skips
  // with "not yet captured/created" — even though the item exists.
  if (
    (op.op === "SetField" || op.op === "AppendToMultiList") &&
    op.latePath &&
    !capturedItemIds.has(op.itemRefKey)
  ) {
    const lateRemote = await cachedReadByPath(op.latePath);
    if (lateRemote) {
      capturedItemIds.set(op.itemRefKey, lateRemote.itemId);
    }
  }
  // PruneChildren resolves its parent the same way — the container is
  // typically pre-existing tenant scaffolding the recipe doesn't itself
  // create (e.g. a Section folder, a Renderings folder).
  if (op.op === "PruneChildren" && op.latePath && !capturedItemIds.has(op.parentRefKey)) {
    const lateRemote = await cachedReadByPath(op.latePath);
    if (lateRemote) {
      capturedItemIds.set(op.parentRefKey, lateRemote.itemId);
    }
  }

  const selector = lookupSelector(op, capturedItemIds);
  let remote = await (async (): Promise<RemoteItem | null> => {
    if (!selector) return null;
    if (selector.path) return cachedReadByPath(selector.path);
    return client.getItem(selector);
  })();
  if (op.op === "CreateItem" && remote) {
    capturedItemIds.set(op.id, remote.itemId);
  }
  // For CreateItem with a path-only parent (top-level items like the
  // configured templatesRoot/renderingsRoot), resolve the parent path to
  // its Sitecore-assigned itemId once and cache it on the captured map
  // keyed by path. The Authoring API requires `parent: ID!` (GUID) on
  // createItem; passing a path errors with "String→Guid" conversion.
  if (op.op === "CreateItem" && op.parent.kind === "ref-path") {
    const parentPath = op.parent.value;
    if (!capturedItemIds.has(parentPath)) {
      const parentRemote = await cachedReadByPath(parentPath);
      if (parentRemote) {
        capturedItemIds.set(parentPath, parentRemote.itemId);
      }
    }
  }
  // Sibling fallback for CreateItem against a null-cached path. Two cases
  // both end with the planner finding the live item it would otherwise
  // duplicate:
  //
  //   1. Path-index lag — Sitecore's path index trails writes by
  //      seconds-to-minutes, so a repeat push within that window sees
  //      `getItem({path})` return null for a path the tenant already has.
  //      A name match among the parent's children is the lag-immune fix.
  //   2. Rename — a CMS user renamed the item, so neither the path nor the
  //      sibling NAME matches. The `Scai Handle` marker is identity that
  //      survives a rename: a child still carrying this recipe's handle IS
  //      the item, just renamed. The marker carries the *recipe* handle, so
  //      every item one recipe creates under a shared parent gets the same
  //      marker — the match is trusted only when exactly one sibling
  //      carries it (an unambiguous (parent, handle) pair); >1 falls
  //      through to the name path, never risking a wrong rebind.
  //
  // Without this, the planner schedules a duplicate create — the
  // `createItem` mutation then either errors through the authoring-client's
  // name-conflict trap (best case) or silently produces a duplicate item.
  //
  // `getChildren(parent)` walks the live item tree and is not lag-prone.
  // Gated on parent-itemId-known so we don't pay an extra getChildren round
  // trip on a true first push (where the parent itself is null too).
  if (op.op === "CreateItem" && !remote) {
    const match = await findCreateItemSibling(op, capturedItemIds, client);
    if (match) {
      remote = match;
      capturedItemIds.set(op.id, match.itemId);
      pathSnapshotCache?.set(op.path, match);
    }
  }

  const action = await (async (): Promise<PlannedAction> => {
    switch (op.op) {
      case "CreateItem":
        return planCreateItem({
          op,
          remote,
          index,
          capturedItemIds,
          baselineIndex,
          conflictPolicy,
        });
      case "SetField":
        return planUpdateOp({
          index,
          op,
          itemRefKey: op.itemRefKey,
          desiredFields: setFieldDesired(op),
          policy: op.policy,
          remote,
          capturedItemIds,
          baselineIndex: baselineFor(op.itemRefKey),
          conflictPolicy,
        });
      case "SetBaseTemplates":
        return planUpdateOp({
          index,
          op,
          itemRefKey: op.itemRefKey,
          desiredFields: setBaseTemplatesDesired(
            op,
            await resolveEffectiveBaseTemplates(op, cachedReadByPath)
          ),
          policy: op.policy,
          remote,
          capturedItemIds,
          baselineIndex: baselineFor(op.itemRefKey),
          conflictPolicy,
        });
      case "SetStandardValues":
        return planUpdateOp({
          index,
          op,
          itemRefKey: op.templateRefKey,
          desiredFields: setStandardValuesDesired(op),
          policy: op.policy,
          remote,
          capturedItemIds,
          baselineIndex: baselineFor(op.templateRefKey),
          conflictPolicy,
        });
      case "CreateSiteFromTemplate":
        return planCreateSite(index, op, capturedItemIds, sitesClient);
      case "AppendToMultiList":
        return planAppendToMultiList(index, op, remote, capturedItemIds);
      case "AddItemVersion":
        return planAddItemVersion(index, op, remote, client);
      case "PruneChildren":
        return planPruneChildren(index, op, capturedItemIds, client, snapshotLanguages);
      case "MediaUpload":
        return planMediaUpload(index, op, capturedItemIds);
    }
  })();
  return { ...action, snapshot: remote };
};

/**
 * Parse a Sitecore multi-list field value (pipe-separated GUIDs, each
 * either bare or curly-wrapped) into a normalised lowercase, no-curly
 * GUID set. Tolerates extra whitespace / empty entries from operator
 * edits.
 */
const parseMultiList = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return value
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^\{|\}$/g, "").toLowerCase());
};

const formatMultiList = (guids: readonly string[]): string =>
  guids.map((g) => `{${g.toUpperCase()}}`).join("|");

/**
 * Plan an `AppendToMultiList` op. Reads the target's current field
 * value, computes the union with the desired values (resolving recipe
 * refs first), and emits an updateItem mutation only when the merge
 * adds something new — otherwise a skip with a clear reason.
 */
const planAppendToMultiList = (
  index: number,
  op: AppendToMultiListOp,
  remote: RemoteItem | null,
  capturedItemIds: ReadonlyMap<string, string>
): PlannedAction => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${op.itemRefKey}) not yet captured — section definition may not exist or path lookup hasn't run.`,
    };
  }

  // Resolve every desired value into a concrete GUID. ref-recipe entries
  // resolve via the captured map; ref-guid entries pass through.
  const desired: string[] = [];
  for (const entry of op.values) {
    if (entry.kind === "ref-guid") {
      desired.push(entry.value.toLowerCase());
    } else {
      const itemId = capturedItemIds.get(entry.refKey);
      if (!itemId) {
        return {
          index,
          operation: op,
          status: "skip",
          reason: `AppendToMultiList: refKey ${entry.refKey} not yet captured — producer recipe hasn't landed.`,
        };
      }
      desired.push(itemId.toLowerCase());
    }
  }

  // Read the current field value — match by name when carried (recipe-
  // defined fields), else by GUID (system fields).
  const found = remote.fields.find((f) => {
    const idMatches = op.fieldName
      ? f.name === op.fieldName
      : f.fieldId.toLowerCase() === op.fieldId.toLowerCase();
    return idMatches;
  });
  const existing = parseMultiList(found?.value ?? null);
  const existingSet = new Set(existing);
  const desiredSet = new Set(desired);

  if (op.appendPolicy === "replace") {
    // Exclusive ownership: the recipe set's `values` IS the full list.
    // Anything in existing but not in desired gets removed; anything in
    // desired but not in existing gets added. Order in the wire format
    // follows desired (recipe-driven order) — Sitecore multi-lists are
    // semantically unordered.
    const added = desired.filter((g) => !existingSet.has(g));
    const removed = existing.filter((g) => !desiredSet.has(g));
    if (added.length === 0 && removed.length === 0) {
      return {
        index,
        operation: op,
        status: "skip",
        reason: "Multi-list already matches desired set (replace policy).",
        replacedListValues: { added: [], removed: [] },
      };
    }
    const updatedField: FieldValue = {
      fieldId: op.fieldId,
      ...(op.fieldName !== undefined && { fieldName: op.fieldName }),
      value: { kind: "string", value: formatMultiList(desired) },
    };
    return {
      index,
      operation: op,
      status: "update",
      diff: [
        {
          fieldId: op.fieldId,
          before: found?.value ?? null,
          after: formatMultiList(desired),
        },
      ],
      mutation: {
        kind: "updateItem",
        input: toUpdateItemInput(remote.itemId, [updatedField]),
      },
      replacedListValues: { added, removed },
    };
  }

  const additions = desired.filter((g) => !existingSet.has(g));
  if (additions.length === 0) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "All desired values already present in multi-list (merge-unique).",
    };
  }

  const merged = [...existing, ...additions];
  const updatedField: FieldValue = {
    fieldId: op.fieldId,
    ...(op.fieldName !== undefined && { fieldName: op.fieldName }),
    value: { kind: "string", value: formatMultiList(merged) },
  };

  return {
    index,
    operation: op,
    status: "update",
    diff: [
      {
        fieldId: op.fieldId,
        before: found?.value ?? null,
        after: formatMultiList(merged),
      },
    ],
    mutation: {
      kind: "updateItem",
      input: toUpdateItemInput(remote.itemId, [updatedField]),
    },
  };
};

/**
 * Plan a `PruneChildren` op. Reads the parent's live children, computes
 * the set difference against `allowedHandles` (resolving recipe refs
 * first), and emits a `pruneChildren` mutation listing the itemIds that
 * would be removed.
 *
 * The op's `mode` and the executor's `--allow-prune` are independent
 * consent layers: the planner emits the same prune list either way, and
 * the executor decides whether to actually delete based on the
 * combination. This keeps the plan output honest under `--what-if` —
 * authors see the full prune list before either gate flips.
 *
 * Idempotence: when nothing under the parent is unaccounted for, the
 * action is `skip` so a re-push is a no-op once convergence is reached.
 */
const planPruneChildren = async (
  index: number,
  op: PruneChildrenOp,
  capturedItemIds: ReadonlyMap<string, string>,
  client: AuthoringApiClient,
  /**
   * Operator override for languages to capture per-(language, version)
   * field snapshots in. When `undefined`, planPruneChildren auto-
   * discovers the tenant's language set via `client.getTenantLanguages`
   * (one wire call per op, cached on the client for the run). When
   * explicitly set (even to `["en"]`), skips auto-discovery and uses
   * exactly the provided list — gives operators a way to bound
   * snapshot cost on tenants where discovery would return languages
   * they don't care to back up.
   */
  snapshotLanguages?: readonly string[]
): Promise<PlannedAction> => {
  const parentItemId = capturedItemIds.get(op.parentRefKey);
  if (!parentItemId) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Parent (refKey ${op.parentRefKey}) not yet captured/created — prune skipped this push.`,
    };
  }

  // Resolve every allowed entry to a concrete itemId. ref-recipe entries
  // not yet captured (e.g. the corresponding CreateItem hasn't run in
  // plan-mode preview) are dropped from the allowlist with a warning —
  // they would NOT cause a real prune at apply time because the executor
  // interleaves plan/apply, so this branch is only reachable during
  // plan-only previews against an empty tenant.
  // Normalize GUIDs via `dashifyGuid` on both sides of every comparison —
  // Sitecore's Authoring API returns templateId/itemId WITHOUT dashes
  // (e.g. `0437fee244c946a6abe928858d9fee8c`) while scai's
  // `SITECORE_TEMPLATES.*` constants and recipe-author hand-written
  // `ref-guid` entries are in canonical dashed form
  // (`0437fee2-44c9-46a6-abe9-28858d9fee8c`). Caught live against
  // TestDemo 2026-06-02: a `templateFilter: [TEMPLATE_FOLDER]` against
  // children Sitecore returned with undashed templateIds was excluding
  // every orphan, silently turning the prune into a skip.
  // `dashifyGuid` is idempotent — works on either form.
  const allowedSet = new Set<string>();
  const unresolved: string[] = [];
  for (const entry of op.allowedHandles) {
    if (entry.kind === "ref-guid") {
      allowedSet.add(dashifyGuid(entry.value));
      continue;
    }
    const itemId = capturedItemIds.get(entry.refKey);
    if (itemId) {
      allowedSet.add(dashifyGuid(itemId));
    } else {
      unresolved.push(entry.refKey);
    }
  }

  const children = await client.getChildren({ itemId: parentItemId });
  const templateAllow = op.templateFilter
    ? new Set(op.templateFilter.map((g) => dashifyGuid(g)))
    : null;

  const toPrune = children.filter((child) => {
    if (allowedSet.has(dashifyGuid(child.itemId))) return false;
    if (templateAllow && !templateAllow.has(dashifyGuid(child.templateId))) return false;
    return true;
  });

  if (toPrune.length === 0) {
    return {
      index,
      operation: op,
      status: "skip",
      reason:
        unresolved.length > 0
          ? `No prune candidates (plan-mode preview: ${unresolved.length} allowedHandles not yet captured).`
          : "All children under parent are in allowedHandles (or filtered out by templateFilter).",
    };
  }

  const itemIds = toPrune.map((c) => c.itemId);

  // Recursive snapshot: walk each top-level prune candidate's subtree
  // depth-first so rollback can restore not just the candidates but
  // their descendants too. Each level costs one getChildren call PLUS
  // one getItem per (language, version) for the per-version field
  // capture. Cost scales as O(subtree-size * L * V) — bounded by what
  // an exclusive ownership declaration's prune set actually contains.
  // Resolve the language set ONCE for this prune op:
  //  - When the operator passed an explicit `snapshotLanguages`, honor
  //    it exactly (skip auto-discovery, bound the cost).
  //  - Otherwise auto-discover via `client.getTenantLanguages` — the
  //    XM Cloud Authoring schema exposes a tenant-level `languages`
  //    connection (verified 2026-06-01 via scripts/_recon-item-languages.ts).
  //    `Item.languages` does NOT exist on that schema, so item-level
  //    discovery isn't possible; the planner instead enumerates every
  //    tenant language and then per-item per-language probes via
  //    `getItemVersions` filter out the ones the item isn't actually
  //    authored in.
  //  - The real client caches the tenant-languages result for its
  //    lifetime, and falls back to `["en"]` on any failure (schema
  //    doesn't expose `languages`, network error, etc.).
  const candidateLanguages: readonly string[] =
    snapshotLanguages ?? (await client.getTenantLanguages());

  const snapshot = async (item: RemoteItem): Promise<PrunedItemSnapshot> => {
    const languagesForItem = candidateLanguages;
    // Capture per-(language, version) field snapshots in TWO round trips
    // (down from the previous L sequential getItemVersions + V_actual
    // sequential getItem):
    //
    //   Pass 1: getItemPerLanguageBatch — one aliased GraphQL query
    //     returns every requested language's version stack PLUS the
    //     latest-version fields. For tenants with single-version-per-
    //     language content this is the only round trip needed.
    //
    //   Pass 2: getItemAtVersionsBatch — only fires when at least one
    //     language has multiple versions. One aliased query collects
    //     fields for every (language, version) tuple NOT already
    //     covered by pass 1's latest-fields.
    //
    // Worst case (3 languages × 3 versions each): 2 round trips per
    // item, down from 12 (3 getItemVersions + 9 getItem). Best case
    // (1 lang, 1 version): 1 round trip, down from 2.
    const sharedFieldsById = new Map<string, RemoteFieldValue>();
    const versions: PrunedItemSnapshot["versions"] = [];
    // Read failures here are NOT caught silently. The previous
    // implementation fell back to `[]` and synthesized a snapshot from
    // the parent `getChildren` response — but those fields are only the
    // default-language latest version, which the rollback path would
    // then have stuffed into whichever language slot the fallback chose.
    // That's silent rollback-state corruption: the operator sees a
    // clean snapshot at plan time and a wrong-fields restoration after
    // an apply abort. Propagating the error errs the prune action and
    // surfaces the failure in the plan output.
    const perLang = await client.getItemPerLanguageBatch({ itemId: item.itemId }, languagesForItem);

    // Index pass-1 results by (language, latestVersion) so we can pull
    // their fields without a pass-2 read.
    const latestByKey = new Map<string, RemoteItem>();
    const tuplesNeedingPass2: Array<{ language: string; version: number }> = [];
    for (const entry of perLang) {
      if (entry.versions.length === 0 || !entry.item) continue;
      const latest = entry.versions[entry.versions.length - 1];
      latestByKey.set(`${entry.language}@${latest}`, entry.item);
      for (const v of entry.versions) {
        if (v !== latest) tuplesNeedingPass2.push({ language: entry.language, version: v });
      }
    }

    // Same propagate-don't-swallow rule for pass 2 reads.
    const pass2 =
      tuplesNeedingPass2.length > 0
        ? await client.getItemAtVersionsBatch({ itemId: item.itemId }, tuplesNeedingPass2)
        : [];

    // Collect each (language, version) tuple's fields, deduping shared
    // fields across reads. Order matches `perLang` traversal so the
    // first language's v1 ends up first in `versions` — which the
    // inverse-mutation builder relies on for picking the default
    // createItem language.
    const collectFromItem = (
      language: string,
      version: number,
      remote: RemoteItem | null
    ): void => {
      if (!remote) return;
      const versionedFields: RemoteFieldValue[] = [];
      for (const f of remote.fields) {
        const isShared = f.language === undefined && f.version === undefined;
        if (isShared) {
          if (!sharedFieldsById.has(f.fieldId)) sharedFieldsById.set(f.fieldId, f);
          continue;
        }
        versionedFields.push(f);
      }
      versions.push({ language, version, fields: versionedFields });
    };

    let pass2Cursor = 0;
    for (const entry of perLang) {
      if (entry.versions.length === 0) continue;
      const latest = entry.versions[entry.versions.length - 1];
      for (const v of entry.versions) {
        if (v === latest) {
          collectFromItem(entry.language, v, latestByKey.get(`${entry.language}@${v}`) ?? null);
        } else {
          collectFromItem(entry.language, v, pass2[pass2Cursor] ?? null);
          pass2Cursor += 1;
        }
      }
    }
    // If NO requested language returned any versions, the item exists
    // at the lookup level but has zero authored content under
    // `languagesForItem`. Two scenarios:
    //   - Operator set `snapshotLanguages` explicitly to a list that
    //     doesn't include the item's actual languages. Operator config
    //     mismatch — fail loudly so they know to widen the list.
    //   - Auto-discovery via getTenantLanguages returned a set that
    //     somehow doesn't intersect with the item's languages. Tenant
    //     inconsistency — fail loudly rather than silently picking a
    //     wrong language and stuffing parent-getChildren fields into
    //     the wrong slot at rollback time.
    if (versions.length === 0) {
      throw createScaiError(
        `PruneChildren snapshot: item '${item.path}' (${item.itemId}) has no versions in any of [${languagesForItem.join(", ")}]. ` +
          (snapshotLanguages
            ? "Widen --snapshot-languages to include this item's actual language(s), or exclude it from the prune."
            : "Auto-discovery returned tenant languages that don't cover this item — explicit --snapshot-languages may be needed."),
        "INPUT_INVALID"
      );
    }

    const childItems = await client.getChildren({ itemId: item.itemId });
    const children = await Promise.all(childItems.map((c) => snapshot(c)));
    return {
      itemId: item.itemId,
      path: item.path,
      templateId: item.templateId,
      name: item.name,
      parentId: item.parentId,
      sharedFields: Array.from(sharedFieldsById.values()),
      versions,
      children,
    };
  };
  const prunedItems = await Promise.all(toPrune.map((c) => snapshot(c)));

  return {
    index,
    operation: op,
    status: "prune",
    reason:
      op.mode === "warn"
        ? "Rehearsal: apply will surface this prune list but skip the actual delete."
        : `Apply will delete ${itemIds.length} item${itemIds.length === 1 ? "" : "s"} (subject to --allow-prune).`,
    prunedItems,
    mutation: {
      kind: "pruneChildren",
      itemIds,
      mode: op.mode,
    },
  };
};

/**
 * Plan an `AddItemVersion` op. Reads the target item's current versions in
 * `op.language` and emits an `addItemVersion` mutation only when the
 * declared `version` doesn't exist yet — so a re-push of a story-seed
 * recipe is an all-`skip` no-op once the version stack is materialised.
 *
 * `addCount` is `op.version - currentMax`: the executor adds that many
 * versions (Sitecore assigns the numbers sequentially). When `language` has
 * no versions yet `currentMax` is 0, and adding version 1 also creates the
 * language version.
 */
const planAddItemVersion = async (
  index: number,
  op: AddItemVersionOp,
  remote: RemoteItem | null,
  client: AuthoringApiClient
): Promise<PlannedAction> => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${op.itemRefKey}) not yet captured/created.`,
    };
  }
  const existing = await client.getItemVersions({ itemId: remote.itemId }, op.language);
  const currentMax = existing.length > 0 ? Math.max(...existing) : 0;
  if (currentMax >= op.version) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Version ${op.version} already exists in '${op.language}'.`,
    };
  }
  return {
    index,
    operation: op,
    status: "create",
    mutation: {
      kind: "addItemVersion",
      itemId: remote.itemId,
      language: op.language,
      addCount: op.version - currentMax,
    },
  };
};

/**
 * Plan a `MediaUpload` op.
 *
 * Idempotency: if a media item already exists at the destination
 * `capturedItemIds.has(op.id)` — populated by an earlier plan-pass
 * lookup or a prior push — the planner emits `skip`. Otherwise it
 * resolves the byte source (URL fetch or local file read) and emits a
 * `mediaUpload` mutation carrying the bytes for the executor to POST
 * to Sitecore's presigned URL.
 *
 * **Path resolution.** `MediaUploadOp.destinationPath` is the absolute
 * content-tree path under `/sitecore/media library/...` the compiler
 * emits. Authoring GraphQL's `uploadMedia` input takes a media-library-
 * RELATIVE path (no `/sitecore/media library/` prefix, no file
 * extension on the leaf — Sitecore's `InvalidItemNameChars` rejects
 * `.` and `/` in item names). The planner strips both for the wire
 * call and asserts the planner-recoverable absolute path round-trips
 * to the server-returned `ItemPath`.
 *
 * **Idempotency lookup** happens at apply time inside `dispatchMutation`
 * — we'd otherwise pay an extra `getItem({path})` per op that the
 * `pathSnapshotCache` doesn't cover for media-library items. Compile
 * always emits `MediaUpload` even on re-pushes; the dispatcher reads
 * remote state and short-circuits if the item exists.
 */
const planMediaUpload = async (
  index: number,
  op: MediaUploadOp,
  capturedItemIds: Map<string, string>
): Promise<PlannedAction> => {
  // If a prior plan-pass or cross-recipe pre-seeding already captured
  // an itemId for this MediaUpload's refKey, skip without re-uploading.
  // The compile-time `MediaUploadOp.id` is the same uuidv5 the
  // `media-xml-ref` SetField uses as its refKey, so a captured value
  // is enough for downstream SetField resolution.
  if (capturedItemIds.has(op.id)) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Media item refKey ${op.id} already captured — skipping re-upload.`,
    };
  }

  let bytes: Uint8Array;
  let mimeType = "image/png";
  let fileName: string | undefined;
  try {
    if (op.source.kind === "external-url") {
      const url = op.source.url;
      const res = await fetch(url);
      if (!res.ok) {
        return {
          index,
          operation: op,
          status: "error",
          reason: `MediaUpload: fetch ${url} → ${res.status} ${res.statusText}`,
        };
      }
      const buf = await res.arrayBuffer();
      bytes = new Uint8Array(buf);
      const headerMime = res.headers.get("content-type");
      if (headerMime) {
        // Strip charset suffix (e.g. `image/svg+xml; charset=utf-8`).
        mimeType = headerMime.split(";")[0].trim() || mimeType;
      }
      const tail = new URL(url).pathname.split("/").filter(Boolean).pop();
      if (tail) fileName = tail;
    } else {
      // kind === "asset" — read from disk relative to cwd. The compiler
      // already resolved relative paths against the recipe file's
      // directory (see compile/site-template.ts), but for safety the
      // executor treats `op.source.path` as an absolute file path OR a
      // cwd-relative path. Recipe authors who want recipe-file-relative
      // paths should let the compiler resolve them.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const absPath = path.isAbsolute(op.source.path)
        ? op.source.path
        : path.resolve(op.source.path);
      bytes = await fs.readFile(absPath);
      const ext = path.extname(absPath).slice(1).toLowerCase();
      if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
      else if (ext === "png") mimeType = "image/png";
      else if (ext === "svg") mimeType = "image/svg+xml";
      else if (ext === "webp") mimeType = "image/webp";
      else if (ext === "gif") mimeType = "image/gif";
      fileName = path.basename(absPath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      index,
      operation: op,
      status: "error",
      reason: `MediaUpload: failed to source bytes (${op.source.kind}): ${message}`,
    };
  }

  // destinationPath is the SXA-rooted absolute path the compiler emits
  // (`/sitecore/media library/SiteTemplates/<recipe>/<basename>`). The
  // Authoring GraphQL mutation rejects both the `/sitecore/media library/`
  // prefix AND any leaf with a `.` in it. Strip both for the wire call;
  // the file extension is stored on the underlying blob field, not on
  // the item name.
  const absolutePath = op.destinationPath ?? `/sitecore/media library/${op.label}`;
  const MEDIA_LIBRARY_PREFIX = "/sitecore/media library/";
  let mediaLibraryRelative = absolutePath.startsWith(MEDIA_LIBRARY_PREFIX)
    ? absolutePath.slice(MEDIA_LIBRARY_PREFIX.length)
    : absolutePath.replace(/^\/+/, "");
  // Drop trailing extension on the leaf only (intermediate folder names
  // are unaffected). Sitecore stores the extension on the underlying
  // blob, not the item name.
  const lastSlash = mediaLibraryRelative.lastIndexOf("/");
  const leaf = lastSlash >= 0 ? mediaLibraryRelative.slice(lastSlash + 1) : mediaLibraryRelative;
  const folder = lastSlash >= 0 ? mediaLibraryRelative.slice(0, lastSlash + 1) : "";
  const dot = leaf.lastIndexOf(".");
  const sanitizedLeaf = dot > 0 ? leaf.slice(0, dot) : leaf;
  mediaLibraryRelative = `${folder}${sanitizedLeaf}`;

  return {
    index,
    operation: op,
    status: "create",
    mutation: {
      kind: "mediaUpload",
      itemPath: mediaLibraryRelative,
      bytes,
      mimeType,
      ...(fileName !== undefined && { fileName }),
      ...(op.altText !== undefined && { altText: op.altText }),
      mediaRefKey: op.id,
    },
  };
};

/**
 * Plan a `CreateSiteFromTemplate` op. Idempotency lookup goes through
 * `SitesApiClient.listSites` (filter by name) — the Sites API doesn't
 * resolve site instances by Sitecore content-tree path the way Authoring
 * API does for items.
 *
 * Outcomes:
 *   - sitesClient missing → status: error (executor was not threaded one)
 *   - templateRefKey not yet captured → status: skip (the SiteTemplate
 *     hasn't been pushed; cross-recipe ref pre-seeding will pick it up
 *     on the next push)
 *   - site already exists with the same name → status: skip; capture
 *     the existing site's itemId so subsequent SetField overrides resolve
 *   - site doesn't exist → status: create; mutation `createSite` carries
 *     a fully-resolved NewSiteInput plus the op's siteRefKey
 *
 * "Already exists with a different template" is NOT detected here —
 * Sites API doesn't expose a clean way to read a site's template
 * back. If a same-named site references a different template, the
 * push silently treats it as "skip"; operators must delete and re-push
 * to switch templates. Tracked as a follow-up.
 */
const planCreateSite = async (
  index: number,
  op: CreateSiteFromTemplateOp,
  capturedItemIds: Map<string, string>,
  sitesClient: SitesApiClient | undefined
): Promise<PlannedAction> => {
  if (!sitesClient) {
    return {
      index,
      operation: op,
      status: "error",
      reason:
        "CreateSiteFromTemplate requires a SitesApiClient — none was provided to the executor.",
    };
  }
  const templateId = capturedItemIds.get(op.templateRefKey);
  if (!templateId) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `siteTemplate refKey ${op.templateRefKey} not yet captured (push the SiteTemplate first or via cross-recipe ref).`,
    };
  }
  const sites = await sitesClient.listSites();
  const existing = sites.find((s) => s.name === op.siteName);
  if (existing?.id) {
    capturedItemIds.set(op.siteRefKey, existing.id);
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Site '${op.siteName}' already exists.`,
    };
  }
  const input: NewSiteInput = {
    siteName: op.siteName,
    templateId,
    language: op.language,
    ...(op.displayName !== undefined && { displayName: op.displayName }),
    ...(op.description !== undefined && { description: op.description }),
    ...(op.hostName !== undefined && { hostName: op.hostName }),
    ...(op.collectionId !== undefined && { collectionId: op.collectionId }),
    ...(op.collectionName !== undefined && { collectionName: op.collectionName }),
    ...(op.collectionDisplayName !== undefined && {
      collectionDisplayName: op.collectionDisplayName,
    }),
    ...(op.collectionDescription !== undefined && {
      collectionDescription: op.collectionDescription,
    }),
  };
  // Languages to ensure on the environment before createSite — the primary
  // plus any declared additionals, de-duped and order-preserving.
  const languages = Array.from(new Set([op.language, ...(op.additionalLanguages ?? [])]));
  return {
    index,
    operation: op,
    status: "create",
    mutation: { kind: "createSite", input, siteRefKey: op.siteRefKey, languages },
  };
};

export const buildPlan = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  options: PlanOptions = {}
): Promise<Plan> => {
  const actions: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0, prune: 0, conflict: 0 };
  const capturedItemIds = options.capturedItemIds ?? new Map<string, string>();

  for (let index = 0; index < ir.operations.length; index += 1) {
    const op = ir.operations[index];
    options.emit?.({ kind: "op-start", index, operation: op });
    let action: PlannedAction;
    try {
      action = await buildAction({
        index,
        op,
        client,
        capturedItemIds,
        sitesClient: options.sitesClient,
        pathSnapshotCache: options.pathSnapshotCache,
        snapshotLanguages: options.snapshotLanguages,
        baselineIndex: options.baselineIndex,
        conflictPolicy: options.conflictPolicy,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      action = {
        index,
        operation: op,
        status: "error",
        reason: message,
      };
      options.emit?.({ kind: "op-error", index, operation: op, error: message });
    }
    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });
  }

  return {
    schemaVersion: "1",
    recipeHandle: ir.recipeHandle,
    actions,
    summary,
  };
};
