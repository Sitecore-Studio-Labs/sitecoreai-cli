import { createScaiError } from "@/shared/errors";
import { extensionForMediaMimeType, mediaMimeTypeForPath } from "@/shared/media-types";
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
import { FOLDER_CLASS_TEMPLATE_IDS, LAYOUT_FIELDS, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { SCAI_HANDLE_FIELD_NAME } from "../items/marker";
import { templatePathRefKey } from "../items/guids";
import {
  dashifyGuid,
  type MediaFallback,
  renderRefValue,
  resolveRecipeRefs,
  sameLevelItemName,
} from "../api/ref-encoding";
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
import { presentLanguageCodes, type NewSiteInput, type SitesApiClient } from "../api/sites-client";
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
        /**
         * Existing-site language provisioning: the CreateSiteFromTemplate
         * target already exists but the environment is missing declared
         * languages. The executor runs the same idempotent ensure the
         * create path runs before `createSite` (registration + fallback
         * wiring); registration is additive and environment-wide.
         */
        kind: "ensureLanguages";
        /** Full declared list (primary + additionals) the ensure runs over. */
        languages: string[];
        /** The subset not present at plan time — for display/diagnostics. */
        missing: string[];
        /**
         * Site-level language provisioning: environment registration alone
         * doesn't surface a locale on the site — the site keeps its own
         * language list (`Site.languages`), and Pages only offers locales
         * on that list. When the existing site's list is missing declared
         * languages, the executor PATCHes the site's `supportedLanguages`
         * with the union — gated at apply time to codes actually
         * registered on the environment after the ensure.
         */
        site?: {
          siteId: string;
          siteName: string;
          /**
           * The site's CONFIGURED language list at plan time
           * (`Site.supportedLanguages` — the property the PATCH writes).
           * Display/diagnostics only: the executor re-reads the site
           * before PATCHing and merges into the fresh list.
           */
          currentLanguages: string[];
          /** Declared languages absent from the site's list at plan time. */
          missing: string[];
        };
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
        /**
         * File name surfaced in the multipart form `file` part. Its
         * extension is what Sitecore's MediaCreator uses to pick the
         * media item's template (Image / Jpeg / Movie / Pdf / … vs the
         * generic File) — the planner guarantees it carries one.
         */
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
  /**
   * Hotlink fallbacks for failed external-URL media uploads — see
   * `BuildActionOptions.mediaFallbacks`.
   */
  mediaFallbacks?: Map<string, MediaFallback>;
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
  capturedItemIds: ReadonlyMap<string, string>,
  mediaFallbacks?: ReadonlyMap<string, MediaFallback>
): FieldValue[] =>
  fields.map((field) => ({
    ...field,
    value: resolveRecipeRefs(field.value, capturedItemIds, mediaFallbacks),
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

interface FieldDriftOptions {
  itemRefKey?: string;
  baselineIndex?: BaselineIndex;
  mediaFallbacks?: ReadonlyMap<string, MediaFallback>;
}

const computeFieldDrift = (
  desired: FieldValue[],
  remote: RemoteItem,
  capturedItemIds: ReadonlyMap<string, string>,
  { itemRefKey, baselineIndex, mediaFallbacks }: FieldDriftOptions = {}
): FieldDiffEntry[] => {
  const drift: FieldDiffEntry[] = [];
  for (const field of desired) {
    const resolvedValue: RefValue = resolveRecipeRefs(field.value, capturedItemIds, mediaFallbacks);
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
 * Key a CreateItem op by the parent it creates under — the same resolution
 * `resolveParentItemIdForFallback` uses, but as the IR-level identity rather
 * than the live itemId (available before anything is captured).
 */
const createItemParentKey = (op: CreateItemOp): string =>
  op.parent.kind === "ref-path" ? op.parent.value : op.parent.refKey;

/**
 * Every item NAME this push's CreateItem ops claim, grouped by parent.
 *
 * The sibling-rename fallback needs this to tell "a CMS user renamed my item"
 * apart from "that item belongs to a DIFFERENT op in this same push".
 * See {@link findCreateItemSibling}.
 */
export const buildSiblingCreateNames = (
  operations: readonly Operation[]
): Map<string, Set<string>> => {
  const byParent = new Map<string, Set<string>>();
  for (const op of operations) {
    if (op.op !== "CreateItem") continue;
    const key = createItemParentKey(op);
    const names = byParent.get(key) ?? new Set<string>();
    names.add(op.name);
    byParent.set(key, names);
  }
  return byParent;
};

/**
 * RefKeys of items this push writes FIELDS to via separate SetField ops.
 *
 * Content-item IRs seed their fields as standalone `SetField` ops rather
 * than on the CreateItem — so the create itself carries only the `Scai
 * Handle` marker and looks fieldless. Convergence eligibility keyed
 * purely on the create's own fields therefore missed the entire
 * content-item class (the blank-environment batch-9 aborts: the create
 * skipped as "already exists", and the SetField ops then hit a
 * wrong-template twin with "Cannot find a field with the name <X>").
 * A create whose refKey appears here WILL write fields downstream, so it
 * needs apply-time convergence exactly as much as one with inline fields.
 */
export const buildFieldTargetRefKeys = (operations: readonly Operation[]): Set<string> => {
  const keys = new Set<string>();
  for (const op of operations) {
    if (op.op === "SetField") keys.add(op.itemRefKey);
  }
  return keys;
};

/**
 * Sibling fallback for a CreateItem whose path lookup returned null —
 * find the live item the planner would otherwise duplicate. Two cases:
 *
 *   1. Path-index lag — a repeat push within the index-propagation window
 *      sees `getItem({path})` return null for a path the tenant has. A
 *      name match among the parent's children is the lag-immune fix.
 *   2. Rename — a CMS user renamed the item, so neither path nor sibling
 *      NAME matches. The `Scai Handle` marker survives a rename.
 *
 * The marker carries the *recipe* handle, so EVERY item one recipe creates
 * under a shared parent carries the SAME marker. A bare "exactly one marked
 * sibling ⇒ it was renamed" test is therefore wrong the moment a recipe
 * creates several items under one parent — which is exactly what inline
 * treelist children do (`Items-1`…`Items-7` under one datasource item):
 *
 *   - `Items-1` creates, and is stamped with the recipe marker.
 *   - `Items-2` misses on path AND on name, sees exactly ONE marked sibling
 *     (`Items-1`, created seconds ago in this same push), concludes "rename",
 *     and rebinds onto it — updating `Items-1` instead of creating `Items-2`.
 *   - The collapse keeps the marked count at one, so `Items-3`…`Items-7` all
 *     rebind onto that same item too.
 *
 * Net effect: N children silently become 1 item, each overwriting the last —
 * a 7-entry nav renders its last entry 7 times. `siblingCreateNames` is the
 * fix: a marked sibling whose NAME is claimed by another CreateItem op in
 * THIS push is that op's item, not a rename of this one, so it is not a
 * rebind candidate. A genuine rename still matches — a renamed item's name is
 * precisely the one no op claims.
 *
 * A marked sibling must also carry the op's TEMPLATE (when the expected
 * template resolves to a live itemId) to count as a rename. A recipe can
 * swap the component behind a slot — e.g. a partial design's header moving
 * from `main-nav@1` to `header@1` renames its scoped datasource slot AND
 * changes its datasource template. The stale item from the previous push
 * still carries this recipe's marker, so without the template check the
 * fallback rebinds onto it, the item keeps its old template, and every
 * SetField for a new-template-only field aborts the recipe with a baffling
 * "Cannot find a field with the name <X>". A different template means "the
 * recipe replaced this item's shape", never "a CMS user renamed it" — so
 * the planner declines the rebind and creates the new item fresh (the stale
 * sibling is left in place, orphaned but harmless).
 *
 * Returns `null` when the parent itemId isn't known yet (true first push)
 * or no sibling matches — the caller then plans a create as normal.
 */
const findCreateItemSibling = async (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>,
  client: AuthoringApiClient,
  siblingCreateNames?: ReadonlyMap<string, ReadonlySet<string>>
): Promise<RemoteItem | null> => {
  const parentItemId = resolveParentItemIdForFallback(op, capturedItemIds);
  if (!parentItemId) return null;
  const siblings = await client.getChildren({ itemId: parentItemId });
  // Prefer the exact name; otherwise match with Sitecore's per-level
  // uniqueness semantics (case-insensitive) — a case-variant sibling
  // would make the planned create collide with "already defined on this
  // level", so it IS this op's item and must be adopted, not duplicated.
  const byName =
    siblings.find((s) => s.name === op.name) ??
    siblings.find((s) => sameLevelItemName(s.name, op.name));
  if (byName) return byName;
  const handle = opHandleMarker(op);
  if (handle === undefined) return null;

  // Names other CreateItem ops in this push will materialise under this same
  // parent. `op.name` itself is excluded from the exclusion set: the byName
  // probe above already handled that case, and keeping it out here would only
  // matter if it somehow reappeared.
  const claimedByOtherOps = siblingCreateNames?.get(createItemParentKey(op));

  const expectedTemplateId = resolveLiveTemplateIdForRebind(op, capturedItemIds);
  // FOLDER-class ops (organisational containers — variants folders,
  // section folders, rendering folders) carry no authored field data, so
  // adopting a marked sibling whose live template differs is lossless
  // and self-healing: a folder created by an older scai under a
  // legacy/grouping template is still THIS recipe's folder. Refusing it
  // would fall through to a create against the same name and collide.
  // The guard's protection target — a datasource/content item whose
  // template changed because the recipe swapped the component behind a
  // slot — never uses these templates, so it keeps refusing the rebind.
  const templateGuardApplies = !isFolderClassCreate(op);

  const marked = siblings.filter(
    (s) =>
      remoteHandleMarker(s) === handle &&
      !(s.name !== op.name && claimedByOtherOps?.has(s.name) === true) &&
      !(
        templateGuardApplies &&
        expectedTemplateId !== null &&
        s.templateId !== "" &&
        dashifyGuid(s.templateId) !== expectedTemplateId
      )
  );
  return marked.length === 1 ? marked[0] : null;
};

/**
 * True when the op creates an item conforming to a known FOLDER-class
 * built-in template (see {@link FOLDER_CLASS_TEMPLATE_IDS}). Only the
 * string-constant form can match — a recipe-created template's refKey or
 * a `ref-path` templateOf is never folder-class.
 */
const isFolderClassCreate = (op: CreateItemOp): boolean =>
  typeof op.templateOf === "string" && FOLDER_CLASS_TEMPLATE_IDS.has(op.templateOf.toLowerCase());

/**
 * The expected LIVE template a CreateItem op's adopted name-twin must be
 * retemplated to, or `null` when adopt-and-retemplate doesn't apply.
 *
 * Eligibility mirrors the failure class it heals — recipe-SEEDED items
 * (content items, page items) whose deterministic path can collide with
 * a twin stranded by an earlier partial/rolled-back install:
 *
 *   - `CreateOnly` policy only. CreateAndUpdate structure ops
 *     (templates, sections, renderings, enumerations, dictionaries)
 *     live under physically site-scoped subtrees and keep their
 *     existing drift-update behavior.
 *   - Not folder-class: organisational folders keep the v0.33.0
 *     lossless adopt-as-is behavior — retemplating them is
 *     unnecessary (no authored data) and could clobber SXA grouping
 *     templates.
 *   - Seeds AUTHORED fields — at least one field beyond the injected
 *     `Scai Handle` marker. This is the positive signal for the
 *     failure class: adoption only breaks when the recipe writes
 *     field values the twin's live template can't resolve. Ops with
 *     no authored fields (recipe-created GROUPING folders — e.g.
 *     `enumerations-grouping-folder`, whose custom folder templates
 *     the built-in folder-class set can't enumerate, and whose
 *     cross-seed twins carry a different site-family template GUID by
 *     construction) adopt as-is untouched, exactly as v0.33.0/0.34.0
 *     did. Without this, v0.34.1 retemplated the `Enumerations/Card`
 *     grouping folder on repeat installs and aborted batch-1.
 * NOTE deliberately ABSENT from this list: plan-time resolution of the
 * expected live template. Batch-separated pushes (the orchestrator's
 * content batches) reference datasource templates whose recipes live in
 * EARLIER batches, so `resolveLiveTemplateIdForRebind` returns null for
 * them — and requiring it here silently disabled convergence for every
 * content batch (0.34.3: batch-9 nav-item/footer-link field ops kept
 * aborting with "Cannot find a field with the name <X>"). Eligibility
 * is plan-local; the authoritative template compare happens at APPLY
 * time in `adoptExistingChild`, against the create mutation's resolved
 * `templateId` (which the mutation must carry regardless).
 */
const convergenceEligible = (
  op: CreateItemOp,
  fieldTargetRefKeys?: ReadonlySet<string>
): boolean => {
  if (op.policy !== "CreateOnly" || isFolderClassCreate(op)) return false;
  // Content-item IRs seed fields as separate SetField ops — the create
  // itself carries only the marker. Those downstream writes abort against
  // a wrong-template twin just like inline fields would, so they make the
  // op convergence-eligible too. Grouping folders have no SetField ops
  // and keep their lossless adopt-as-is behavior.
  if (fieldTargetRefKeys?.has(op.id)) return true;
  const markerName = SCAI_HANDLE_FIELD_NAME.toLowerCase();
  return op.fields.some((f) => {
    const name = (f.fieldName ?? "").toLowerCase();
    // System fields (`__Masters` insert options on data folders,
    // `__Renderings`, …) exist on every template — a twin can always
    // absorb them, so they don't make an op convergence-eligible.
    return name !== "" && !name.startsWith("__") && name !== markerName;
  });
};

/**
 * The versionless base of a `Scai Handle` marker (`nav-item-about@1` →
 * `nav-item-about`). Re-versioned recipes (`@1` → `@2`) still own their
 * item — only a DIFFERENT recipe family is foreign.
 */
const markerHandleBase = (handle: string): string => handle.split("@")[0] ?? handle;

/**
 * Whether a `Scai Handle` marker is a synthetic cross-recipe AGGREGATE
 * handle (`__enumeration-templates__`, `__shared-data-folders__`, …) —
 * the `__…__` convention `compile/aggregates.ts` mints for shared items
 * a whole recipe SET co-owns. Concrete recipe handles never take this
 * form (`action-placement@1`, `hero@1`). Used by the ownership-collision
 * guard to recognise the pre-aggregate → aggregate ownership migration.
 */
const isSyntheticAggregateHandle = (handle: string): boolean => /^__.+__$/.test(handle);

/**
 * The live templateId a rebind candidate must carry, or `null` when it
 * can't be known — in which case the template check is skipped (the
 * pre-check-era behavior).
 *
 * Only `capturedItemIds` hits are trusted: the workspace push seeds every
 * cross-recipe template refKey to its LIVE itemId before planning
 * (`seedCrossRecipeRefs`), and same-recipe template creates capture on
 * apply. An unresolved string `templateOf` is ambiguous — it may be a
 * Sitecore built-in constant (live) or a deterministic refKey whose
 * template item simply wasn't looked up (not live) — so it can't be
 * compared against a candidate's live templateId without producing false
 * mismatches that would break the rename fallback outright.
 */
const resolveLiveTemplateIdForRebind = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): string | null => {
  const refKey =
    typeof op.templateOf === "string" ? op.templateOf : templatePathRefKey(op.templateOf.value);
  const captured = capturedItemIds.get(refKey);
  // Path-valued entries (pre-seeded ref-path parents) aren't itemIds.
  if (!captured || captured.startsWith("/")) return null;
  return dashifyGuid(captured);
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

/**
 * The `Scai Handle` marker value that the item OWNS, or `undefined` when
 * unmarked.
 *
 * The marker is a SHARED field, so a component template that carries the
 * marker on its `__Standard Values` makes every datasource item built on
 * that template INHERIT the component's handle. An inherited marker is NOT
 * ownership — reading it as such makes a page's scoped-datasource op collide
 * with the component whose template it conforms to ("owned by 'hero@1', not
 * 'sync-home@1'"). So an inherited value (`containsStandardValue`) counts as
 * unmarked. Fields predating the flag (mocks, older reads) omit it and are
 * treated as own values, preserving prior behavior.
 */
const remoteHandleMarker = (item: RemoteItem): string | undefined => {
  const field = item.fields.find(
    (f) => (f.name ?? "").toLowerCase() === SCAI_HANDLE_FIELD_NAME.toLowerCase()
  );
  if (!field || field.containsStandardValue === true) return undefined;
  return field.value;
};

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
  mediaFallbacks?: ReadonlyMap<string, MediaFallback>;
  /** RefKeys this push writes fields to via SetField ops — see {@link buildFieldTargetRefKeys}. */
  fieldTargetRefKeys?: ReadonlySet<string>;
}

const planCreateItem = ({
  op,
  remote,
  index,
  capturedItemIds,
  baselineIndex,
  conflictPolicy,
  mediaFallbacks,
  fieldTargetRefKeys,
}: PlanCreateItemOptions): PlannedAction => {
  const convergent = convergenceEligible(op, fieldTargetRefKeys);
  const retemplateTarget = convergent ? resolveLiveTemplateIdForRebind(op, capturedItemIds) : null;
  const planFreshCreate = (reason?: string): PlannedAction => {
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
      resolvedFields = resolveAll(op.fields, capturedItemIds, mediaFallbacks);
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
      ...(reason !== undefined && { reason }),
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
          // Recipe-seeded (CreateOnly, non-folder, authored-fields)
          // items opt in to apply-time CONVERGENCE: if the pre-check /
          // already-exists fallback adopts a name-twin, the client
          // compares templates against this mutation's resolved
          // templateId and adopts same-shape twins as-is, replaces
          // marker-verified childless residue, or errors precisely —
          // instead of adopting untouched and aborting on the first
          // field write with "Cannot find a field with the name <X>".
          // See `adoptExistingChild` in authoring-client.ts.
          ...(convergent && { retemplateOnAdopt: true }),
        },
      },
    };
  };
  if (!remote) {
    return planFreshCreate();
  }
  // MARKER-FIRST IDENTITY: a name-twin whose `Scai Handle` marker belongs
  // to a DIFFERENT recipe family is not this op's item at all — it is a
  // cross-recipe NAME COLLISION (two recipes materialising items with the
  // same name under the same parent). Adopting it can never be right: the
  // foreign template may not resolve this recipe's fields (the
  // blank-environment "Cannot find a field with the name Title/HasPanel"
  // aborts), and even when it does, both recipes would silently
  // ping-pong one item. Deleting it would destroy the OTHER recipe's
  // content. Fail the op at plan time with both owners named so the
  // recipe author de-collides the names — the only correct fix.
  // Scoped to FIELD-BEARING creates (`convergent` — CreateOnly, non-folder,
  // with authored fields inline or via SetField ops): the failure mode the
  // guard prevents is field writes against a wrong-template twin, which a
  // field-less item cannot suffer. Organizational/grouping folders
  // (`Presentation/Enumerations/Layout`, shared data folders, …) are
  // legitimately claimed by MANY recipes but wear only the FIRST creator's
  // marker — guarding them broke every re-push against an environment with
  // history ("Name collision: item 'Layout' … is owned by recipe
  // 'alignment@1', not 'alert-layout@1'"). They keep the v0.33.0 lossless
  // adopt-as-is behavior. Versionless handle-base compare so a
  // re-versioned recipe (`@1`→`@2`) still owns its item.
  if (convergent) {
    const opMarker = opHandleMarker(op);
    const twinMarker = remoteHandleMarker(remote)?.trim();
    if (
      opMarker !== undefined &&
      twinMarker !== undefined &&
      twinMarker !== "" &&
      markerHandleBase(twinMarker) !== markerHandleBase(opMarker)
    ) {
      // IDEMPOTENT-BY-DEFAULT. A live item's owner marker can legitimately
      // differ from the op's on a re-install for reasons that are NOT a
      // genuine two-recipes-collide bug:
      //   - shared infra materialised by whichever recipe compiled FIRST
      //     before it was centralised under an aggregate (pre-aggregate
      //     `__enumeration-templates__` / `__shared-data-folders__` migration);
      //   - an item that moved between recipes across versions of the set;
      //   - the same content re-installed after the compile order shifted.
      // Aborting here broke every re-push against an environment with history
      // — and the "conflict" is almost always the *same* content being
      // installed again. So ADOPT the live item + re-stamp it to the op's
      // marker at apply time (the create pre-check re-finds the twin and, for
      // convergent ops, retemplates it), converging on the current set as the
      // authority (last-writer-wins) instead of failing the install.
      //
      // The ONE case still treated as a hard conflict: BOTH markers are
      // synthetic aggregates. Two different `__…__` aggregates claiming the
      // same item is a compiler wiring bug, not tenant history — surface it.
      if (isSyntheticAggregateHandle(opMarker) && isSyntheticAggregateHandle(twinMarker)) {
        return {
          index,
          operation: op,
          status: "error",
          reason:
            `Aggregate ownership conflict: item '${op.name}' at '${remote.path}' ` +
            `(${remote.itemId}) is claimed by both '${twinMarker}' and '${opMarker}'. Two ` +
            `cross-recipe aggregates materialise the same item — this is a compiler bug, not ` +
            `tenant history.`,
        };
      }
      return planFreshCreate(
        `Item '${op.name}' at '${remote.path}' (${remote.itemId}) carries owner marker ` +
          `'${twinMarker}'; adopting + re-stamping ownership to '${opMarker}' (idempotent ` +
          `re-install — converging on the current recipe set as the authority).`
      );
    }
  }
  // Plan-time adoption (path-prefetch hit or sibling byName fallback) of a
  // name-twin whose live template differs from the op's expected LIVE
  // template: don't adopt-and-write — the item is a stranded twin, and
  // every field-by-name write against its stale/dangling template aborts
  // the recipe. Route through a normal create mutation instead: the
  // apply-time pre-check re-finds the twin and `adoptExistingChild`
  // retemplates + seeds it (creates are pool barriers, so the heal
  // completes before any dependent SetField dispatches). Scoped to
  // CreateOnly non-folder ops with a live-resolved expected template —
  // CreateAndUpdate structure ops keep their drift-update behavior
  // (their subtrees are physically site-scoped and never hit this
  // collision class), and folder-class ops keep the v0.33.0 lossless
  // adopt-as-is behavior.
  if (convergent && sameLevelItemName(remote.name, op.name)) {
    // The divert relies on the apply-time pre-check re-finding the twin
    // BY NAME among the parent's children — valid for name-twins only. A
    // twin matched via the MARKER fallback under a different name (a CMS
    // rename) would not be re-found, so the create would duplicate it;
    // renamed twins keep the plan-time adoption below.
    const verifiedMatch =
      retemplateTarget !== null &&
      remote.templateId !== "" &&
      dashifyGuid(remote.templateId) === retemplateTarget;
    if (!verifiedMatch) {
      // Mismatch, OR the compare is unverifiable at plan time (the
      // template's recipe lives in an earlier batch, so its refKey was
      // never captured — the 0.34.3 batch-9 hole). Either way, route
      // through the create mutation: its apply-time pre-check adopts a
      // matching or same-shape twin untouched, and converges the rest.
      return planFreshCreate(
        retemplateTarget !== null
          ? `Existing item at '${remote.path}' (${remote.itemId}) carries template ` +
              `${dashifyGuid(remote.templateId)} but the recipe expects ${retemplateTarget} — ` +
              `converging the name-twin at apply time (adopt if its template resolves the ` +
              `recipe's fields; replace marker-verified childless residue otherwise).`
          : `Existing item at '${remote.path}' (${remote.itemId}) cannot be template-verified ` +
              `at plan time (expected template not captured in this batch) — deferring to ` +
              `apply-time convergence (adopt when its template resolves the recipe's fields; ` +
              `replace marker-verified childless residue otherwise).`
      );
    }
  }
  if (op.policy === "CreateOnly") {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Item already exists and policy is CreateOnly.",
    };
  }
  const drift = computeFieldDrift(op.fields, remote, capturedItemIds, {
    itemRefKey: op.id,
    baselineIndex,
    mediaFallbacks,
  });
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
    capturedItemIds,
    mediaFallbacks
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
  mediaFallbacks?: ReadonlyMap<string, MediaFallback>;
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
  mediaFallbacks,
}: PlanUpdateOpOptions): PlannedAction => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${itemRefKey}) not yet captured/created.`,
    };
  }
  const drift = computeFieldDrift(desiredFields, remote, capturedItemIds, {
    itemRefKey,
    baselineIndex,
    mediaFallbacks,
  });
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
      input: toUpdateItemInput(
        remote.itemId,
        resolveAll(desiredFields, capturedItemIds, mediaFallbacks)
      ),
    },
  };
};

/**
 * Plan a shared-layout transition clear — a SetField carrying
 * `clearWhenEquivalentTo` (see `SetFieldOpSchema`). Clears the op's
 * (language, version) `__Final Renderings` cell ONLY while its current
 * value is layout-equivalent to the XML the recipe's own versioned
 * emission writes; an author-edited final (Pages writes author changes
 * into Final Layout) fails the equivalence check and is preserved with
 * an explicit skip reason.
 *
 * Reads the target cell explicitly via `getItem({ itemId, language,
 * version })` — the generic drift read is default-language only, so a
 * final edited in just one language would otherwise be judged by
 * another language's value and clobbered. The language-scoped snapshot
 * is returned on the action so rollback restores the exact cell.
 */
const planGuardedLayoutClear = async ({
  index,
  op,
  remote,
  client,
  createdThisRun,
}: {
  index: number;
  op: SetFieldOp;
  remote: RemoteItem | null;
  client: AuthoringApiClient;
  createdThisRun?: ReadonlySet<string>;
}): Promise<PlannedAction> => {
  const expected = op.clearWhenEquivalentTo;
  if (expected === undefined) {
    throw createScaiError(
      `planGuardedLayoutClear requires clearWhenEquivalentTo on '${op.label}'.`,
      "UNKNOWN"
    );
  }
  // An item created earlier in this push has no per-language finals to
  // clear — skip without paying the language-scoped read.
  if (createdThisRun?.has(op.itemRefKey)) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Item created this push — no prior __Final Renderings to clear.",
    };
  }
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${op.itemRefKey}) not yet captured/created.`,
    };
  }
  const cell = await client.getItem(
    { itemId: remote.itemId },
    {
      ...(op.language !== undefined && { language: op.language }),
      ...(op.version !== undefined && { version: op.version }),
    }
  );
  const current = cell
    ? lookupField(cell, op.fieldId, op.fieldName, undefined, undefined)
    : undefined;
  if (!cell || current === undefined || current.value === "") {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `No __Final Renderings to clear in '${op.language ?? "default"}'.`,
    };
  }
  if (!layoutXmlEquivalent(current.value, expected)) {
    return {
      index,
      operation: op,
      status: "skip",
      reason:
        `__Final Renderings in '${op.language ?? "default"}' differs from the recipe's ` +
        "versioned layout — author-edited Final Layout preserved. Clear it in Pages " +
        "(or reset the Final Layout) to adopt the shared layout for this language.",
    };
  }
  const fields: FieldValue[] = [
    {
      fieldId: op.fieldId,
      fieldName: op.fieldName,
      language: op.language,
      version: op.version,
      value: { kind: "string", value: "" },
    },
  ];
  return {
    index,
    operation: op,
    status: "update",
    diff: [
      {
        fieldId: op.fieldId,
        before: current.value,
        after: "",
        language: op.language,
        version: op.version,
      },
    ],
    mutation: { kind: "updateItem", input: toUpdateItemInput(remote.itemId, fields) },
    // The language-scoped cell, not the default-language `remote` —
    // rollback's inverse restores the value this clear actually removed.
    snapshot: cell,
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
      effective.push(remote.itemId);
    } else {
      effective.push(...pathBase.fallbackTemplates);
    }
  }
  // `dashifyGuid` (not a bare lowercase) — Authoring `getItem`/`createItem`
  // return DASHLESS itemIds, and `ref-guid-list` values must carry the
  // dashed form Sitecore resolves.
  return [...new Set(effective.map((guid) => dashifyGuid(guid)))];
};

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
  /**
   * Item names this push's CreateItem ops claim, grouped by parent — built
   * once per plan by {@link buildSiblingCreateNames}.
   *
   * Guards the sibling-rename fallback against rebinding one op onto ANOTHER
   * op's item when a single recipe creates several items under one parent
   * (inline treelist children). Omitting it restores the old, unsafe
   * "exactly one marked sibling ⇒ rename" behavior — see
   * {@link findCreateItemSibling}.
   */
  siblingCreateNames?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Push-scoped itemId → snapshot cache for itemId-selector reads, with
   * write-through from the executor's apply loop — see
   * `ExecuteOptions.idSnapshotCache`. When absent, every op pays its own
   * `getItem({ itemId })` round trip (the historical behavior).
   */
  idSnapshotCache?: Map<string, RemoteItem>;
  /**
   * Push-scoped itemId → (language → max version) stacks for
   * `planAddItemVersion` — see `ExecuteOptions.versionStackCache`.
   */
  versionStackCache?: Map<string, Map<string, number>>;
  /**
   * Every language the current IR adds versions to on THIS op's target
   * refKey (only set for `AddItemVersion` ops). Lets the version-stack
   * seed read fetch all of them in one batch.
   */
  addVersionLanguagesHint?: readonly string[];
  /**
   * Hotlink fallbacks for failed external-URL media uploads — written
   * by `planMediaUpload` when byte sourcing fails, read by every
   * `media-xml-ref` resolution so the referencing field degrades to
   * `<image src="…" />` instead of aborting the push. Callers pushing
   * multiple IRs pass ONE map so cross-IR refs see earlier failures.
   */
  mediaFallbacks?: Map<string, MediaFallback>;
  /** RefKeys this push writes fields to via SetField ops — see {@link buildFieldTargetRefKeys}. */
  fieldTargetRefKeys?: ReadonlySet<string>;
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
  idSnapshotCache,
  versionStackCache,
  addVersionLanguagesHint,
  mediaFallbacks,
  siblingCreateNames,
  fieldTargetRefKeys,
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

  // Path reads for `SetBaseTemplates.pathBases` distrust cached NULLS:
  // the referenced tenant scaffolding (e.g. the collection `Page`
  // template) can be created MID-PUSH by a `CreateSiteFromTemplate` in
  // an earlier IR, after an earlier lookup already cached "missing" in
  // the shared snapshot cache. Positive cache entries are still used;
  // misses re-read live (and cache a hit for later ops).
  const readPathBaseDistrustingNull = async (path: string): Promise<RemoteItem | null> => {
    const cached = pathSnapshotCache?.get(path);
    if (cached) return cached;
    const remote = await client.getItem({ path });
    if (remote) pathSnapshotCache?.set(path, remote);
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
    // ItemId-selector reads carry no language/version, so every op on
    // the same item reads identical data — dedupe through the push-wide
    // cache (write-through kept current by the executor's apply loop;
    // see ExecuteOptions.idSnapshotCache).
    if (selector.itemId !== undefined) {
      const cached = idSnapshotCache?.get(selector.itemId.toLowerCase());
      if (cached) return cached;
      const wire = await client.getItem(selector);
      if (wire) idSnapshotCache?.set(selector.itemId.toLowerCase(), wire);
      return wire;
    }
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
    const match = await findCreateItemSibling(op, capturedItemIds, client, siblingCreateNames);
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
          mediaFallbacks,
          fieldTargetRefKeys,
        });
      case "SetField":
        // Shared-layout transition clears own their whole plan path —
        // the ownership guard needs the op's exact (language, version)
        // cell, which the generic default-language read can't supply.
        if (op.clearWhenEquivalentTo !== undefined) {
          return planGuardedLayoutClear({ index, op, remote, client, createdThisRun });
        }
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
          mediaFallbacks,
        });
      case "SetBaseTemplates":
        return planUpdateOp({
          index,
          op,
          itemRefKey: op.itemRefKey,
          desiredFields: setBaseTemplatesDesired(
            op,
            await resolveEffectiveBaseTemplates(op, readPathBaseDistrustingNull)
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
        return planAddItemVersion(index, op, remote, client, {
          versionStackCache,
          languagesHint: addVersionLanguagesHint,
        });
      case "PruneChildren":
        return planPruneChildren(index, op, capturedItemIds, client, snapshotLanguages);
      case "MediaUpload":
        return planMediaUpload(index, op, capturedItemIds, mediaFallbacks);
    }
  })();
  // A planner that captured its own snapshot (e.g. the guarded layout
  // clear's language-scoped cell) keeps it — the default-language
  // `remote` would point rollback at the wrong (language, version).
  return { ...action, snapshot: action.snapshot !== undefined ? action.snapshot : remote };
};

/**
 * Parse a Sitecore multi-list field value (pipe-separated GUIDs, each
 * either bare or curly-wrapped) into a normalised lowercase, no-curly
 * GUID set. Tolerates extra whitespace / empty entries from operator
 * edits.
 */
const parseMultiList = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return (
    value
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      // `dashifyGuid` (idempotent) so dashless entries — operator edits or
      // values written before the formatMultiList dashify fix — compare
      // equal to their dashed form instead of producing duplicates.
      .map((s) => dashifyGuid(s.replace(/^\{|\}$/g, "")))
  );
};

const formatMultiList = (guids: readonly string[]): string =>
  // `dashifyGuid` is load-bearing: captured itemIds from `createItem`
  // arrive DASHLESS, and Sitecore silently ignores dashless GUIDs in
  // TreelistEx/multilist fields (e.g. `__Masters` insert options never
  // resolved, so installed page types never appeared in Pages' Create
  // page flow).
  guids.map((g) => `{${dashifyGuid(g).toUpperCase()}}`).join("|");

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
      desired.push(dashifyGuid(entry.value));
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
      desired.push(dashifyGuid(itemId));
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
/**
 * Resolve the current max version of `(item, language)` for
 * `planAddItemVersion`. With a `versionStackCache`, the first read of an
 * item fetches its stacks for EVERY language the IR adds to it
 * (`languagesHint`) in one `getItemPerLanguageBatch` call — a 9-locale
 * item's version reconciliation costs 1 round trip, not 9 — and the
 * executor's write-through keeps the stacks current across ops. Without
 * a cache, fall back to the historical per-op `getItemVersions` read.
 */
const readCurrentMaxVersion = async (
  client: AuthoringApiClient,
  itemId: string,
  language: string,
  versionStackCache: Map<string, Map<string, number>> | undefined,
  languagesHint: readonly string[] | undefined
): Promise<number> => {
  const itemKey = itemId.toLowerCase();
  const languageKey = language.toLowerCase();
  const cachedStack = versionStackCache?.get(itemKey);
  const cachedMax = cachedStack?.get(languageKey);
  if (cachedMax !== undefined) return cachedMax;
  if (versionStackCache) {
    const languages = [...new Set([language, ...(languagesHint ?? [])])];
    const perLanguage = await client.getItemPerLanguageBatch({ itemId }, languages);
    const stack = cachedStack ?? new Map<string, number>();
    for (const entry of perLanguage) {
      // Never clobber a write-through value with a wire read that may
      // predate an in-flight add on another stack of the same item.
      if (stack.has(entry.language.toLowerCase())) continue;
      stack.set(
        entry.language.toLowerCase(),
        entry.versions.length > 0 ? Math.max(...entry.versions) : 0
      );
    }
    versionStackCache.set(itemKey, stack);
    return stack.get(languageKey) ?? 0;
  }
  const existing = await client.getItemVersions({ itemId }, language);
  return existing.length > 0 ? Math.max(...existing) : 0;
};

const planAddItemVersion = async (
  index: number,
  op: AddItemVersionOp,
  remote: RemoteItem | null,
  client: AuthoringApiClient,
  caches?: {
    versionStackCache?: Map<string, Map<string, number>>;
    languagesHint?: readonly string[];
  }
): Promise<PlannedAction> => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${op.itemRefKey}) not yet captured/created.`,
    };
  }
  const currentMax = await readCurrentMaxVersion(
    client,
    remote.itemId,
    op.language,
    caches?.versionStackCache,
    caches?.languagesHint
  );
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
/** Per-fetch timeout for external-URL media byte sourcing. */
const MEDIA_FETCH_TIMEOUT_MS = 15_000;
/** Response-size cap for external-URL media byte sourcing. */
const MEDIA_FETCH_MAX_BYTES = 20 * 1024 * 1024;

/**
 * SSRF hygiene for external-URL media fetches: recipe files can come
 * from third-party registries, so refuse loopback / RFC1918 /
 * link-local / unique-local hosts. Literal-hostname checks only — no
 * DNS resolution (a resolver-based guard is still TOCTOU-racy; runners
 * that need stronger isolation put an egress proxy in front).
 */
const isPrivateMediaHost = (url: URL): boolean => {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  // IPv6: loopback, link-local (fe80::/10), unique-local (fc00::/7).
  if (host === "::1" || /^fe[89ab]/i.test(host) || /^f[cd]/i.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
};

const planMediaUpload = async (
  index: number,
  op: MediaUploadOp,
  capturedItemIds: Map<string, string>,
  mediaFallbacks?: Map<string, MediaFallback>
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

  // destinationPath is the SXA-rooted absolute path the compiler emits
  // (`/sitecore/media library/SiteTemplates/<recipe>/<basename>`). The
  // Authoring GraphQL mutation rejects both the `/sitecore/media library/`
  // prefix AND any leaf with a `.` in it. Strip both for the wire call;
  // the file extension is stored on the underlying blob field, not on
  // the item name. (Computed before byte sourcing because the sanitized
  // leaf also names the uploaded file below.)
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

  let bytes: Uint8Array;
  let mimeType = "image/png";
  let fileName: string | undefined;
  // Degrade-don't-abort for EXTERNAL-URL sourcing failures: record the
  // failure on the action (status "error", visible in --json / NDJSON
  // progress) AND register a hotlink fallback so every referencing
  // `media-xml-ref` SetField resolves to the legacy `<image src="…"/>`
  // form instead of throwing (which would abort + roll back the whole
  // recipe). Asset-source failures deliberately never register one —
  // a missing checked-in asset is an authoring bug, not an
  // environmental hazard.
  const failExternal = (url: string, reason: string): PlannedAction => {
    mediaFallbacks?.set(op.id, {
      url,
      ...(op.altText !== undefined ? { alt: op.altText } : {}),
    });
    return { index, operation: op, status: "error", reason };
  };
  try {
    if (op.source.kind === "external-url") {
      const url = op.source.url;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return failExternal(url, `MediaUpload: invalid external URL '${url}'.`);
      }
      if (isPrivateMediaHost(parsedUrl)) {
        return failExternal(
          url,
          `MediaUpload: refusing to fetch private/loopback host '${parsedUrl.hostname}' (SSRF guard).`
        );
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        return failExternal(url, `MediaUpload: fetch ${url} → ${res.status} ${res.statusText}`);
      }
      const headerMime = res.headers.get("content-type");
      if (headerMime) {
        // Strip charset suffix (e.g. `image/svg+xml; charset=utf-8`).
        mimeType = headerMime.split(";")[0].trim() || mimeType;
      }
      // Soft-404 guard: hosts that answer dead image URLs with an HTML
      // error page would otherwise upload an HTML blob as media.
      if (mimeType === "text/html") {
        return failExternal(
          url,
          `MediaUpload: fetch ${url} returned content-type text/html — not a media asset (soft 404?).`
        );
      }
      const declaredLength = Number(res.headers.get("content-length") ?? Number.NaN);
      if (Number.isFinite(declaredLength) && declaredLength > MEDIA_FETCH_MAX_BYTES) {
        return failExternal(
          url,
          `MediaUpload: fetch ${url} declares ${declaredLength} bytes — exceeds the ${MEDIA_FETCH_MAX_BYTES}-byte cap.`
        );
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MEDIA_FETCH_MAX_BYTES) {
        return failExternal(
          url,
          `MediaUpload: fetch ${url} returned ${buf.byteLength} bytes — exceeds the ${MEDIA_FETCH_MAX_BYTES}-byte cap.`
        );
      }
      bytes = new Uint8Array(buf);
      // Sitecore's MediaCreator selects the media item's TEMPLATE (Image /
      // Jpeg / Movie / Pdf / … vs the generic catch-all File) from the
      // uploaded filename's extension — the multipart content type plays
      // no part in template selection. Generated-image URLs often carry no
      // extension in their path (dicebear's `/svg?seed=x` ends in `svg`
      // the path segment, not `.svg` the extension), so the filename must
      // always be given a real one: the URL path's own extension when it
      // has one, else the extension implied by the response Content-Type
      // (`bin` only when both are absent/unrecognized — an honest File).
      const tail = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      const tailDot = tail.lastIndexOf(".");
      const urlExtension = tailDot > 0 ? tail.slice(tailDot + 1).toLowerCase() : "";
      const extension = /^[a-z0-9]{1,8}$/.test(urlExtension)
        ? urlExtension
        : (extensionForMediaMimeType(mimeType) ?? "bin");
      fileName = `${sanitizedLeaf}.${extension}`;
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
      mimeType = mediaMimeTypeForPath(absPath) ?? mimeType;
      fileName = path.basename(absPath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = `MediaUpload: failed to source bytes (${op.source.kind}): ${message}`;
    if (op.source.kind === "external-url") {
      return failExternal(op.source.url, reason);
    }
    return { index, operation: op, status: "error", reason };
  }

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
  // Languages the recipe declares for this site — the primary plus any
  // additionals, de-duped and order-preserving. Both the create path
  // (pre-createSite ensure) and the existing-site path (below) provision
  // from this same list.
  const declaredLanguages = Array.from(new Set([op.language, ...(op.additionalLanguages ?? [])]));
  const sites = await sitesClient.listSites();
  const existing = sites.find((s) => s.name === op.siteName);
  // The existing-site branch runs BEFORE the templateRefKey check on
  // purpose: language provisioning doesn't need the site template, and an
  // install step that pushes the site recipe without its SiteTemplate ref
  // captured must still keep the environment + site language lists in
  // step (the early template skip used to silently swallow the ensure).
  if (existing?.id) {
    capturedItemIds.set(op.siteRefKey, existing.id);
    // The site exists, but the environment may still be missing declared
    // languages — e.g. a language added to the brand AFTER the site was
    // first installed. The create path ensures languages before
    // `createSite`; without this branch an existing-site install never
    // provisions them and the later localize pass silently drops the
    // locales the environment lacks. Plan an idempotent ensure for the
    // missing set (registration is additive and environment-wide).
    const present = presentLanguageCodes(await sitesClient.listLanguages());
    const missing = declaredLanguages.filter((code) => !present.has(code.toLowerCase()));
    // The site keeps its own language list independent of the environment
    // registry — a locale registered on the environment still doesn't show
    // up in Pages until it's on the site's list too. Diff against
    // `Site.supportedLanguages` — the site's CONFIGURED list, the same
    // property the update PATCH writes and the one Pages offers locales
    // from. NOT `Site.languages`: that's "languages in use by the site"
    // (content-derived), and a localize pass that already wrote de-DE
    // versions makes the locale look present there while Pages still
    // doesn't offer it.
    const siteLanguages = existing.supportedLanguages ?? [];
    const onSite = new Set(siteLanguages.map((code) => code.toLowerCase()));
    const missingOnSite = declaredLanguages.filter((code) => !onSite.has(code.toLowerCase()));
    if (missing.length > 0 || missingOnSite.length > 0) {
      const reasons: string[] = [];
      if (missing.length > 0) {
        reasons.push(`registering missing environment language(s): ${missing.join(", ")}`);
      }
      if (missingOnSite.length > 0) {
        reasons.push(`adding missing site language(s): ${missingOnSite.join(", ")}`);
      }
      return {
        index,
        operation: op,
        status: "update",
        reason: `Site '${op.siteName}' exists; ${reasons.join("; ")}.`,
        mutation: {
          kind: "ensureLanguages",
          languages: declaredLanguages,
          missing,
          ...(missingOnSite.length > 0 && {
            site: {
              siteId: existing.id,
              siteName: op.siteName,
              currentLanguages: siteLanguages,
              missing: missingOnSite,
            },
          }),
        },
      };
    }
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Site '${op.siteName}' already exists and all declared languages are registered.`,
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
  return {
    index,
    operation: op,
    status: "create",
    mutation: {
      kind: "createSite",
      input,
      siteRefKey: op.siteRefKey,
      languages: declaredLanguages,
    },
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
  // Which names this IR's creates claim under each parent — lets the
  // sibling-rename fallback avoid rebinding one create onto another's item.
  const siblingCreateNames = buildSiblingCreateNames(ir.operations);
  // Which refKeys this IR writes fields to via SetField ops — makes
  // fieldless content-item creates convergence-eligible.
  const fieldTargetRefKeys = buildFieldTargetRefKeys(ir.operations);

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
        siblingCreateNames,
        fieldTargetRefKeys,
        sitesClient: options.sitesClient,
        pathSnapshotCache: options.pathSnapshotCache,
        snapshotLanguages: options.snapshotLanguages,
        baselineIndex: options.baselineIndex,
        conflictPolicy: options.conflictPolicy,
        mediaFallbacks: options.mediaFallbacks,
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
