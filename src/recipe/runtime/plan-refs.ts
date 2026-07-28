import type {
  CreateItemOp,
  FieldValue,
  Operation,
  SetBaseTemplatesOp,
  SetFieldOp,
  SetStandardValuesOp,
} from "../ir/operations";
import { FOLDER_CLASS_TEMPLATE_IDS, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { SCAI_HANDLE_FIELD_NAME } from "../items/marker";
import { templatePathRefKey } from "../items/guids";
import { dashifyGuid, type MediaFallback, resolveRecipeRefs } from "../api/ref-encoding";
import type {
  AuthoringApiClient,
  ItemSelector,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "../api/client";

export const lookupField = (
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
export const resolveAll = (
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
export const toUpdateItemInput = (itemId: string, fields: FieldValue[]): UpdateItemInput => {
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
export const resolveCreateItemParent = (
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
export const resolveParentItemIdForFallback = (
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
export const createItemParentKey = (op: CreateItemOp): string =>
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
 * True when the op creates an item conforming to a known FOLDER-class
 * built-in template (see {@link FOLDER_CLASS_TEMPLATE_IDS}). Only the
 * string-constant form can match — a recipe-created template's refKey or
 * a `ref-path` templateOf is never folder-class.
 */
export const isFolderClassCreate = (op: CreateItemOp): boolean =>
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
export const convergenceEligible = (
  op: CreateItemOp,
  fieldTargetRefKeys?: ReadonlySet<string>
): boolean => {
  if (isFolderClassCreate(op)) return false;
  // A partial-design scoped datasource slot flagged `convergeOnTemplateDrift`
  // is CreateAndUpdate (the recipe owns it) but MUST adopt-and-retemplate when
  // its slot's component changes between pushes — otherwise the stale template
  // is field-updated in place and the new component's field write aborts
  // ("Cannot find a field with the name X"). Force it eligible so it routes
  // through the same convergence path CreateOnly ops get; the downstream
  // template compare only retemplates on a genuine drift, so a matching
  // template stays a no-op. The flag is set ONLY for these path-referenced,
  // recipe-owned slots (never GUID-referenced page-design slots or user
  // content), so the CreateAndUpdate exclusion below still holds for
  // everything else.
  if (op.convergeOnTemplateDrift) return true;
  if (op.policy !== "CreateOnly") return false;
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
export const markerHandleBase = (handle: string): string => handle.split("@")[0] ?? handle;

/**
 * Whether a `Scai Handle` marker is a synthetic cross-recipe AGGREGATE
 * handle (`__enumeration-templates__`, `__shared-data-folders__`, …) —
 * the `__…__` convention `compile/aggregates.ts` mints for shared items
 * a whole recipe SET co-owns. Concrete recipe handles never take this
 * form (`action-placement@1`, `hero@1`). Used by the ownership-collision
 * guard to recognise the pre-aggregate → aggregate ownership migration.
 */
export const isSyntheticAggregateHandle = (handle: string): boolean => /^__.+__$/.test(handle);

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
export const resolveLiveTemplateIdForRebind = (
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
export const opHandleMarker = (op: CreateItemOp): string | undefined => {
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
export const remoteHandleMarker = (item: RemoteItem): string | undefined => {
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
export const resolveTemplateOf = (
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

export const setFieldDesired = (op: SetFieldOp): FieldValue[] => [
  {
    fieldId: op.fieldId,
    fieldName: op.fieldName,
    language: op.language,
    version: op.version,
    value: op.value,
  },
];

export const setBaseTemplatesDesired = (
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
export const resolveEffectiveBaseTemplates = async (
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

export const setStandardValuesDesired = (op: SetStandardValuesOp): FieldValue[] => [
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
export const lookupSelector = (
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
 * Parse a Sitecore multi-list field value (pipe-separated GUIDs, each
 * either bare or curly-wrapped) into a normalised lowercase, no-curly
 * GUID set. Tolerates extra whitespace / empty entries from operator
 * edits.
 */
export const parseMultiList = (value: string | null | undefined): string[] => {
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

export const formatMultiList = (guids: readonly string[]): string =>
  // `dashifyGuid` is load-bearing: captured itemIds from `createItem`
  // arrive DASHLESS, and Sitecore silently ignores dashless GUIDs in
  // TreelistEx/multilist fields (e.g. `__Masters` insert options never
  // resolved, so installed page types never appeared in Pages' Create
  // page flow).
  guids.map((g) => `{${dashifyGuid(g).toUpperCase()}}`).join("|");

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
export const readCurrentMaxVersion = async (
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

/** Per-fetch timeout for external-URL media byte sourcing. */
export const MEDIA_FETCH_TIMEOUT_MS = 15_000;

/** Response-size cap for external-URL media byte sourcing. */
export const MEDIA_FETCH_MAX_BYTES = 20 * 1024 * 1024;

/**
 * SSRF hygiene for external-URL media fetches: recipe files can come
 * from third-party registries, so refuse loopback / RFC1918 /
 * link-local / unique-local hosts. Literal-hostname checks only — no
 * DNS resolution (a resolver-based guard is still TOCTOU-racy; runners
 * that need stronger isolation put an egress proxy in front).
 */
export const isPrivateMediaHost = (url: URL): boolean => {
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
