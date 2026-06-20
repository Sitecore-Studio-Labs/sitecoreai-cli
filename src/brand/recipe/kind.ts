/**
 * The `brand-kit` recipe kind — wires the Sitecore AI Skills Brand
 * Management API into the `sync` engine.
 *
 * `ref.id` is the brand kit's display NAME — recipes identify a kit by
 * name, not UUID. `readCurrent` resolves it to a live kit; `apply` does
 * full orchestration: when the kit is absent it runs `seedBrandKit`
 * (create → upload → publish → ingest → enrich), then converges field
 * values via `updateBrandKitField`.
 *
 * See docs/recipe-sync-architecture.md.
 */
import {
  createBrandKit,
  publishBrandKit,
  updateBrandKitLogo,
  getBrandKit,
  listBrandKitFields,
  listBrandKitSections,
  listBrandKits,
  seedBrandKit,
  updateBrandKitField,
  createBrandKitSectionField,
  type BrandApiClientOptions,
  type BrandKitFieldSummary,
  type BrandKitFieldType,
  type BrandKitFieldValue,
  type BrandKitSummary,
} from "@/brand";
import { createScaiError, toMergeConflicts } from "@/shared/errors";
import { resolveMissingCurrentPlan } from "@/sync";
import type {
  ApplyResult,
  Baseline,
  KindRef,
  PushConflictPolicy,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  ResolvedIdentity,
  SyncContext,
} from "@/sync";
import {
  captureBrandBaselinePayload,
  classifyBrandCells,
  mergeBrandByPolicy,
  type BrandBaselinePayload,
} from "./baseline";
import { resolveBrandClient } from "./client";
import { diffBrandKit } from "./diff";

const BRAND_KIT_KIND_NAME = "brand-kit";
import {
  BrandKitRecipeSchema,
  type BrandDocument,
  type BrandFieldValue,
  type BrandKitRecipe,
} from "./schema";

/** Map key for a (section name, field name) pair. The NUL separator
 *  (never legal in a section or field name) lets the diagnostic block
 *  below `split("\x00")` the key back into its parts unambiguously —
 *  a plain space would collide with the spaces in names like
 *  "Legacy Section". Written as the `\x00` escape, not a raw NUL byte,
 *  so the source stays valid UTF-8 text and git can diff it. */
const fieldKey = (section: string, field: string): string => `${section}\x00${field}`;

/** Find a brand kit by display name, paging through the list endpoint. */
const findKitByName = async (
  client: BrandApiClientOptions,
  name: string,
  signal?: AbortSignal
): Promise<BrandKitSummary | null> => {
  let pageNumber = 1;
  for (;;) {
    const page = await listBrandKits({ client, pageNumber, signal });
    const match = page.data.find((kit) => kit.name === name);
    if (match) return match;
    const seen = pageNumber * (page.pageSize ?? (page.data.length || 1));
    if (page.data.length === 0 || seen >= page.totalCount) return null;
    pageNumber += 1;
  }
};

/**
 * Prefer-id resolver: `getBrandKit(tenantId)` first, fall back to the
 * name-based paging lookup. Same pattern brief-types + briefs +
 * campaigns use — keeps re-pushes idempotent across kit name edits.
 */
const findKitByIdOrName = async (
  client: BrandApiClientOptions,
  ref: KindRef,
  tenantId: string | undefined,
  signal?: AbortSignal
): Promise<BrandKitSummary | null> => {
  if (tenantId) {
    try {
      const kit = await getBrandKit({ client, brandKitId: tenantId, signal });
      if (kit) return kit;
    } catch {
      // 404 or transient — fall through.
    }
  }
  return findKitByName(client, ref.id, signal);
};

/** Enumerate every brand kit on the remote, paging the list endpoint. */
const list = async (ctx: SyncContext): Promise<KindRef[]> => {
  const client = resolveBrandClient(ctx);
  const refs: KindRef[] = [];
  let pageNumber = 1;
  for (;;) {
    const page = await listBrandKits({ client, pageNumber, signal: ctx.signal });
    for (const kit of page.data) {
      refs.push({ kind: "brand-kit", id: kit.name });
    }
    const seen = pageNumber * (page.pageSize ?? (page.data.length || 1));
    if (page.data.length === 0 || seen >= page.totalCount) break;
    pageNumber += 1;
  }
  return refs;
};

/**
 * Project a live field value into the clean recipe shape (server ids
 * dropped). Three array shapes round-trip:
 *   - richArray  → `{name, tags?, restrictions?}` entries
 *   - glossary   → `{term, locale, displayName?}` rows
 *   - array      → `{name}` entries (plain object-array, default)
 */
const toRecipeValue = (field: BrandKitFieldSummary): BrandFieldValue | undefined => {
  const value = field.value;
  if (typeof value === "string") return value === "" ? undefined : value;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries = value as unknown as ReadonlyArray<Record<string, unknown>>;
  const isGlossary = entries.some((e) => "locale" in e || "term" in e);
  if (isGlossary) {
    return entries.map((e) => ({
      term: typeof e.term === "string" ? e.term : "",
      locale: typeof e.locale === "string" ? e.locale : "",
      displayName: typeof e.displayName === "string" ? e.displayName : undefined,
    }));
  }
  const isRich = entries.some((e) => "tags" in e || "restrictions" in e);
  if (isRich) {
    return entries.map((e) => ({
      name: typeof e.name === "string" ? e.name : "",
      tags: Array.isArray(e.tags) ? (e.tags as string[]) : undefined,
      restrictions: typeof e.restrictions === "string" ? e.restrictions : undefined,
    }));
  }
  return entries.map((e) => ({ name: typeof e.name === "string" ? e.name : "" }));
};

/** Extract a display string from a recipe entry of any of the array shapes. */
const entryToName = (entry: unknown): string => {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    if (typeof o.name === "string" && o.name) return o.name;
    if (typeof o.term === "string" && o.term) return o.term;
    // Last-resort: first non-empty string property, so an off-schema
    // LLM entry (e.g. `{scenario: "…"}`) still contributes a name
    // rather than landing as `{name: undefined}` and breaking render.
    for (const v of Object.values(o)) {
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
};

/** Flatten any field value to a single text string (newline-joined). */
const toTextValue = (value: BrandFieldValue): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(entryToName).filter(Boolean).join("\n");
  }
  return "";
};

/**
 * Normalise any field value to the object-array shape Sitecore expects
 * for `array` / `richArray` fields: `[{ name }]` or
 * `[{ name, tags, restrictions }]`. A stray string is wrapped as a
 * single entry; off-schema entries are coerced to at least carry `name`.
 *
 * `richArray` entries ALWAYS carry `tags` (an array) and `restrictions`
 * (a string), even when empty. The Sitecore AI section page renders each
 * entry with `entry.tags.map(...)` and an UNGUARDED read of
 * `restrictions` — omit `tags` and it throws
 * `Cannot read properties of undefined (reading 'map')`, taking the whole
 * Tone of Voice / Image Style page down. Emitting `tags: []` /
 * `restrictions: ""` keeps the render safe. (The registry editor guards
 * with `?? []`, so this only manifests in the Sitecore AI app.)
 */
const toObjectArrayValue = (value: BrandFieldValue, rich: boolean): BrandKitFieldValue => {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? [value]
      : [];
  const entries = raw
    .map((entry) => {
      const name = entryToName(entry);
      if (!name) return null;
      if (!rich) return { name };
      const o = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const tags = Array.isArray(o.tags)
        ? (o.tags.filter((t) => typeof t === "string") as string[])
        : [];
      const restrictions = typeof o.restrictions === "string" ? o.restrictions : "";
      return {
        name,
        tags,
        restrictions,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  return entries as unknown as BrandKitFieldValue;
};

/**
 * Convert a recipe field value into the API write shape, COERCED to the
 * live field's `type`. The recipe's value union (string | object-array)
 * is permissive — an LLM-generated recipe can carry a plain string for a
 * `richArray` field (e.g. "Tone scenarios", "Image style scenarios") or
 * an object-array for a `text` field. Writing the raw value into a field
 * of the wrong type corrupts it: the Sitecore AI app then maps over a
 * string (or renders an object as text) and the section page throws.
 *
 * We know the live field's `type` from the section/field index, so emit
 * exactly the shape that type requires. When the type is unknown (older
 * API response without the discriminator) we fall back to the legacy
 * passthrough.
 */
/**
 * True when an array value carries Glossary/Localization rows. These
 * live in `array`-typed fields but use `{term, locale, displayName?}`,
 * NOT `{name}` — so the plain `array` coercion would destroy them.
 */
const isGlossaryValue = (value: BrandFieldValue): boolean =>
  Array.isArray(value) &&
  value.some((e) => e !== null && typeof e === "object" && ("term" in e || "locale" in e));

/** Normalise glossary rows to the `{term, locale, displayName?}` write shape. */
const toGlossaryValue = (value: BrandFieldValue): BrandKitFieldValue => {
  if (!Array.isArray(value)) return [] as unknown as BrandKitFieldValue;
  const rows = value
    .map((entry) => {
      const o = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const term = typeof o.term === "string" ? o.term : "";
      const locale = typeof o.locale === "string" ? o.locale : "";
      if (!term && !locale) return null;
      const displayName = typeof o.displayName === "string" ? o.displayName : undefined;
      return { term, locale, ...(displayName ? { displayName } : {}) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  return rows as unknown as BrandKitFieldValue;
};

const toApiValue = (
  value: BrandFieldValue,
  fieldType: BrandKitFieldType | undefined
): BrandKitFieldValue => {
  switch (fieldType) {
    case "text":
      return toTextValue(value);
    case "array":
      // Glossary rows are stored in `array`-typed fields but carry
      // `{term, locale, displayName}`, not `{name}` — preserve them.
      return isGlossaryValue(value) ? toGlossaryValue(value) : toObjectArrayValue(value, false);
    case "richArray":
      return toObjectArrayValue(value, true);
    default:
      return typeof value === "string" ? value : (value as BrandKitFieldValue);
  }
};

interface FieldTarget {
  sectionId: string;
  fieldId: string;
  /** Live field type — drives `toApiValue` coercion so we never PATCH a
   *  shape the field can't render. Optional: older API responses may omit
   *  the discriminator. */
  type?: BrandKitFieldType;
}

/** Index a kit's fields by (section name, field name) for id resolution. */
const indexFields = async (
  client: BrandApiClientOptions,
  brandKitId: string,
  signal?: AbortSignal
): Promise<Map<string, FieldTarget>> => {
  const index = new Map<string, FieldTarget>();
  for (const section of await listBrandKitSections({ client, brandKitId, signal })) {
    for (const field of await listBrandKitFields({
      client,
      brandKitId,
      sectionId: section.id,
      signal,
    })) {
      index.set(fieldKey(section.name, field.name), {
        sectionId: section.id,
        fieldId: field.id,
        type: field.type,
      });
    }
  }
  return index;
};

/** A live `richArray` field whose entries are missing the canonical
 *  `tags` / `restrictions` keys. The Sitecore AI section render does an
 *  UNGUARDED `entry.tags.map(...)`, so such a field crashes the Tone of
 *  Voice / Image Style page until it's rewritten in canonical shape. */
type NonCanonicalRichArray = { section: string; field: string; value: BrandFieldValue };

const richArrayNeedsCanonicalize = (field: BrandKitFieldSummary): boolean =>
  field.type === "richArray" &&
  Array.isArray(field.value) &&
  field.value.some(
    (e) => e !== null && typeof e === "object" && (!("tags" in e) || !("restrictions" in e))
  );

/**
 * Read the live kit AND flag any `richArray` field whose entries lack
 * the canonical tags/restrictions. `readCurrent` (the kind method)
 * returns just the recipe; `plan` uses the flags to force a repair.
 */
const readCurrentInternal = async (
  ref: KindRef,
  ctx: SyncContext
): Promise<{ recipe: BrandKitRecipe; nonCanonicalRichArray: NonCanonicalRichArray[] } | null> => {
  const client = resolveBrandClient(ctx);
  // Prefer the baseline-stored tenant id when available so a kit
  // rename between pushes doesn't lose the resolution.
  let tenantId: string | undefined;
  if (ctx.baselineStorage) {
    try {
      const prior = await ctx.baselineStorage.load<BrandBaselinePayload>(
        BRAND_KIT_KIND_NAME,
        ctx.environmentName,
        ref.id
      );
      tenantId = prior?.payload?.tenantId;
    } catch {
      // best-effort
    }
  }
  const kit = await findKitByIdOrName(client, ref, tenantId, ctx.signal);
  if (!kit) return null;

  const sections: BrandKitRecipe["sections"] = {};
  const sectionProperties: BrandKitRecipe["sectionProperties"] = {};
  const nonCanonicalRichArray: NonCanonicalRichArray[] = [];
  for (const section of await listBrandKitSections({
    client,
    brandKitId: kit.id,
    signal: ctx.signal,
  })) {
    const fields: Record<string, BrandFieldValue> = {};
    for (const field of await listBrandKitFields({
      client,
      brandKitId: kit.id,
      sectionId: section.id,
      signal: ctx.signal,
    })) {
      const value = toRecipeValue(field);
      if (value !== undefined) fields[field.name] = value;
      if (value !== undefined && richArrayNeedsCanonicalize(field)) {
        nonCanonicalRichArray.push({ section: section.name, field: field.name, value });
      }
    }
    if (Object.keys(fields).length > 0) sections[section.name] = fields;

    // Capture section-level properties Sitecore stores alongside the
    // field dictionary — today only `sourceLanguage` (Glossary's base
    // language) is load-bearing.
    const props = section.properties as { sourceLanguage?: string } | undefined;
    if (props?.sourceLanguage) {
      sectionProperties[section.name] = { sourceLanguage: props.sourceLanguage };
    }
  }

  return {
    recipe: {
      name: kit.name,
      description: kit.description ?? undefined,
      industry: kit.industry ?? undefined,
      logo: (kit as { logo?: string | null }).logo ?? undefined,
      documents: [],
      sections,
      sectionProperties,
    },
    nonCanonicalRichArray,
  };
};

/** Capture a live brand kit as a recipe. `null` when no kit has the name. */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<BrandKitRecipe | null> => {
  const internal = await readCurrentInternal(ref, ctx);
  return internal ? internal.recipe : null;
};

/**
 * Three-way merge gate: throw before any writes when the planner marked
 * unresolved conflicts under the `"error"` policy. No-op otherwise.
 */
const assertNoPolicyError = (plan: RecipePlan, ref: KindRef): void => {
  const policyErrorChange = plan.changes.find((change) => change.meta?.policyError === true);
  if (!policyErrorChange) return;
  const errors =
    (policyErrorChange.meta?.policyErrors as
      | Array<{ path: string; classification: string }>
      | undefined) ?? [];
  throw createScaiError(
    `Brand kit "${ref.id}" has ${errors.length} unresolved three-way merge conflict(s).`,
    "POLICY_DENIED",
    {
      hint: "Re-run with `conflictPolicy: 'cms-wins'` (preserve Sitecore AI edits) or `'recipe-wins'` (clobber). Or pull the kit first to converge the recipe against the tenant.",
      details: errors.map((e) => `${e.path} → ${e.classification}`),
      conflicts: toMergeConflicts(errors),
    }
  );
};

/**
 * Load the baseline-stored tenant id for a kit, best-effort. Returns
 * `undefined` when there's no baseline storage, no prior baseline, or a
 * load error (all non-fatal — resolution falls back to name match).
 */
const loadPriorTenantId = async (ctx: SyncContext, refId: string): Promise<string | undefined> => {
  if (!ctx.baselineStorage) return undefined;
  try {
    const prior = await ctx.baselineStorage.load<BrandBaselinePayload>(
      BRAND_KIT_KIND_NAME,
      ctx.environmentName,
      refId
    );
    return prior?.payload?.tenantId;
  } catch {
    return undefined;
  }
};

/**
 * Self-heal probe for stuck kits: when NONE of the section/field pairs
 * the writes target are reachable on the live kit, publish the kit. The
 * canonical section + field set is materialized on *publish* (no
 * document, no enrichment), so publishing repairs a kit that was created
 * but never published. Idempotent. Does nothing when there are no writes
 * or at least one target already resolves.
 */
const selfHealUnreachableKit = async (
  client: BrandApiClientOptions,
  brandKitId: string,
  fieldChanges: RecipeChange[],
  ref: KindRef,
  ctx: SyncContext
): Promise<void> => {
  const writeKeys = fieldChanges
    .filter((c) => c.kind === "create" || c.kind === "update")
    .map((c) => ({
      section: typeof c.meta?.section === "string" ? c.meta.section : "",
      field: typeof c.meta?.field === "string" ? c.meta.field : "",
    }))
    .filter((k) => k.section && k.field);
  if (writeKeys.length === 0) return;
  const sectionsTargetedByWrites = Array.from(new Set(writeKeys.map((k) => k.section)));
  const initialIndex = await indexFields(client, brandKitId, ctx.signal);
  const anyTargetReachable = writeKeys.some((k) => initialIndex.has(fieldKey(k.section, k.field)));
  if (anyTargetReachable) return;
  // None of the targeted sections/fields are reachable. The canonical
  // section + field set is created as a side-effect of *publishing* a
  // kit — not (as previously believed) by running enrichment over an
  // uploaded document. A kit created but never published therefore has
  // zero sections and skips every field write. Publishing is idempotent
  // (already-published kits return 200) and needs no document or paid
  // enrichment pipeline, so we can always self-heal by publishing.
  ctx.logger?.info(
    `Brand kit "${ref.id}" has none of the ${sectionsTargetedByWrites.length} targeted section(s) reachable (live field count: ${initialIndex.size}) — publishing to materialize the canonical sections (no document, no enrichment).`
  );
  await publishBrandKit({ client, brandKitId, signal: ctx.signal });
};

/**
 * Diagnostic: when every field write skipped, name the section/field
 * mismatches so the operator can reconcile the recipe with the live
 * kit's section names. No-op unless every field-stage applied change is
 * absent and at least one change skipped.
 */
const logFieldSkipDiagnostic = (args: {
  applied: RecipeChange[];
  skipped: RecipeChange[];
  writes: RecipeChange[];
  index: Map<string, FieldTarget>;
  ref: KindRef;
  ctx: SyncContext;
}): void => {
  const { applied, skipped, writes, index, ref, ctx } = args;
  if (applied.filter((c) => c.meta?.stage === "field").length !== 0 || skipped.length === 0) return;
  const liveSectionNames = Array.from(
    new Set(Array.from(index.keys()).map((k) => k.split("\x00")[0]))
  );
  const liveFieldsBySection: Record<string, string[]> = {};
  for (const key of index.keys()) {
    const [s, f] = key.split("\x00");
    if (!s || !f) continue;
    (liveFieldsBySection[s] ??= []).push(f);
  }
  const missed = writes
    .map((c) => `${String(c.meta?.section)} / ${String(c.meta?.field)}`)
    .slice(0, 17);
  ctx.logger?.info(
    `Every field write skipped — recipe targets ${missed.length} fields whose section/field names do not match the live kit's structure. Live sections: [${liveSectionNames.join(", ")}]. Recipe targets: [${missed.join(", ")}]. Reconcile the recipe's section/field names against \`scai brand sync pull --kit "${ref.id}"\`.`
  );
  for (const [section, fields] of Object.entries(liveFieldsBySection)) {
    ctx.logger?.info(`  live: ${section} -> [${fields.join(", ")}]`);
  }
};

/**
 * Re-read the live kit post-apply and persist the three-way baseline.
 * Best-effort — a baseline write failure logs and degrades the next
 * push to two-way mode rather than throwing.
 */
const captureBrandBaseline = async (
  ref: KindRef,
  ctx: SyncContext,
  brandKitId: string
): Promise<void> => {
  if (!ctx.baselineStorage) return;
  const snapshot = await readCurrent(ref, ctx);
  if (!snapshot) return;
  const payload = captureBrandBaselinePayload(snapshot, brandKitId);
  const baseline: Baseline<BrandBaselinePayload> = {
    envelopeVersion: "1",
    kind: BRAND_KIT_KIND_NAME,
    recipeHandle: ref.id,
    envName: ctx.environmentName,
    capturedAt: new Date().toISOString(),
    payload,
  };
  try {
    await ctx.baselineStorage.write(BRAND_KIT_KIND_NAME, ctx.environmentName, ref.id, baseline);
  } catch (err) {
    ctx.logger?.error?.(
      `Brand-kit baseline write failed for "${ref.id}" — next push will operate in two-way mode: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
};

/** Apply a plan — full orchestration: create/ingest the kit, then converge values. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = resolveBrandClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  // Three-way merge gate: refuse before any writes when the planner
  // marked unresolved conflicts under the `"error"` policy.
  assertNoPolicyError(plan, ref);

  const kitChange = plan.changes.find((change) => change.meta?.stage === "kit");
  const documentChanges = plan.changes.filter((change) => change.meta?.stage === "document");
  const fieldChanges = plan.changes.filter((change) => change.meta?.stage === "field");
  const logoChange = plan.changes.find((change) => change.meta?.stage === "logo");

  // Resolve the kit id. Two creation paths:
  //   - operator shipped real source documents → full seed (upload +
  //     publish + ingest + AI enrichment) so sections are populated from
  //     their content.
  //   - no document → create + publish. The canonical section + field set
  //     is materialized on *publish* (verified), so no stub document and
  //     no paid enrichment are needed; the field loop below converges
  //     values into those sections via PATCH.
  let brandKitId: string;
  if (kitChange) {
    const name = String(kitChange.after);
    const description = kitChange.meta?.description as string | undefined;
    const industry = kitChange.meta?.industry as string | undefined;
    const operatorDocuments = documentChanges
      .map((change) => change.meta?.document as BrandDocument | undefined)
      .filter((doc): doc is BrandDocument => doc !== undefined);

    if (operatorDocuments.length > 0 && !ctx.skipEnrichment) {
      ctx.logger?.info(
        `Seeding brand kit "${name}" — create -> upload ${operatorDocuments.length} doc(s) -> publish -> ingest -> enrich (paid, ~5-15 min).`
      );
      // `seedBrandKit` accepts the recipe-shaped `BrandDocument` union
      // directly; registry-file variants without a resolved URL get
      // rejected there with a clear hint. Pulling that translation
      // up into the kind runner would duplicate the rejection seam.
      const result = await seedBrandKit({
        client,
        name,
        documents: operatorDocuments,
        description,
        industry,
        signal: ctx.signal,
        onProgress: (event) =>
          ctx.logger?.info(`  [+${event.elapsedSec}s] ${event.stage}: ${event.message}`),
      });
      brandKitId = result.kit.id;
    } else {
      if (operatorDocuments.length > 0 && ctx.skipEnrichment) {
        ctx.logger?.info(
          `\`--no-enrich\` set — skipping ingestion/enrichment of ${operatorDocuments.length} document(s) for "${name}"; creating + publishing the kit so field values still converge into the canonical sections.`
        );
      }
      const kit = await createBrandKit({ client, name, description, industry, signal: ctx.signal });
      // Publish materializes the canonical sections + fields — the field
      // loop below writes into them. Idempotent on an already-published kit.
      await publishBrandKit({ client, brandKitId: kit.id, signal: ctx.signal });
      brandKitId = kit.id;
    }
    applied.push(kitChange, ...documentChanges);
  } else {
    // Prefer baseline-stored tenant id over name match — robust to
    // kit name edits between pushes.
    const priorTenantId = await loadPriorTenantId(ctx, ref.id);
    const found = await findKitByIdOrName(client, ref, priorTenantId, ctx.signal);
    if (!found) {
      throw createScaiError(`Brand kit "${ref.id}" not found`, "INPUT_INVALID", {
        hint: "Push a recipe with documents to create the kit, or check the name.",
      });
    }
    brandKitId = found.id;
  }

  // Converge the kit-level logo (a plain URL, PATCHed directly). Runs for
  // both freshly-created and pre-existing kits, independent of sections.
  if (logoChange) {
    await updateBrandKitLogo({
      client,
      brandKitId,
      logo: String(logoChange.after),
      signal: ctx.signal,
    });
    applied.push(logoChange);
  }

  // Self-heal path for stuck kits: an existing kit that was created but
  // never published has zero sections (the canonical section + field set
  // is materialized on publish), so the field-PATCH loop below would
  // silently skip every write. The self-heal publishes such a kit.
  //
  // We trigger self-heal when an indexFields probe finds NONE of
  // the section/field pairs the writes target. That covers the
  // unpublished-kit shape (zero sections) and sections-with-wrong-names
  // — without firing on a partially populated kit where some targets
  // already exist.
  await selfHealUnreachableKit(client, brandKitId, fieldChanges, ref, ctx);

  // Converge field values against the (now-existing) kit.
  const writes = fieldChanges.filter(
    (change) => change.kind === "create" || change.kind === "update"
  );
  if (writes.length > 0) {
    const index = await indexFields(client, brandKitId, ctx.signal);
    // Section name → id, so a missing glossary term (a field the
    // enrichment pipeline never creates) can be created in the right
    // section. Cheap extra GET; keeps `indexFields`/its other callers
    // unchanged.
    const sectionIdByName = new Map<string, string>();
    for (const s of await listBrandKitSections({ client, brandKitId, signal: ctx.signal })) {
      sectionIdByName.set(s.name, s.id);
    }
    for (const change of writes) {
      const section = String(change.meta?.section);
      const field = String(change.meta?.field);
      const target = index.get(fieldKey(section, field));
      if (!target) {
        // Glossary & Localization terms are fields the enrichment
        // pipeline never produces — each term IS a field. Create it so
        // terms actually land (detected by the `{term, locale}` row
        // shape). Any OTHER missing field stays skipped: enrichment
        // owns creation for the predefined sections, and blindly
        // creating fields there would diverge from the kit's schema.
        const sectionId = sectionIdByName.get(section);
        if (sectionId && isGlossaryValue(change.after as BrandFieldValue)) {
          await createBrandKitSectionField({
            client,
            brandKitId,
            sectionId,
            name: field,
            type: "array",
            value: toApiValue(change.after as BrandFieldValue, "array"),
            signal: ctx.signal,
          });
          applied.push(change);
          continue;
        }
        // The field is not on the kit — enrichment never created it.
        // Surfaced as skipped, not silently dropped.
        skipped.push(change);
        continue;
      }
      // Lock the field against subsequent enrichment runs. Sitecore's
      // EnrichSectionsPipeline is async — it may keep populating field
      // content for minutes after `seedBrandKit` returns (we only
      // wait for sections to *appear*, not for enrichment to finish).
      // Without `aiEditable: false` on operator-authored PATCHes, a
      // late-arriving enrichment write can overwrite the recipe value
      // with AI-generated content from enrichment — the "ruins half
      // the work we seed" symptom. The flag pins the field's value to
      // what scai just wrote.
      await updateBrandKitField({
        client,
        brandKitId,
        sectionId: target.sectionId,
        fieldId: target.fieldId,
        value: toApiValue(change.after as BrandFieldValue, target.type),
        aiEditable: false,
        signal: ctx.signal,
      });
      applied.push(change);
    }
    // Diagnostic: if every write skipped, name the section/field
    // mismatches so the operator can reconcile the recipe with the
    // live kit's section names. Without this hint, the operator
    // stares at "Applied 0; N skipped" and has no idea why.
    logFieldSkipDiagnostic({ applied, skipped, writes, index, ref, ctx });
  }
  for (const change of fieldChanges) {
    if (change.kind === "noop") skipped.push(change);
  }

  // Three-way merge baseline capture. Re-read live state so the
  // baseline reflects what actually landed (including
  // enrichment-authored values on a freshly-seeded kit) rather than
  // trust desired, which may have diverged at the field-skip path
  // when the section/field structure didn't match.
  await captureBrandBaseline(ref, ctx, brandKitId);

  // Surface the resolved Sitecore AI brand-kit UUID so the caller
  // (orchestrator) can stamp it onto its brand_kits row. Without this,
  // downstream campaign pushes have no SAI UUID to populate
  // `brandkit_id` on Orchestrate projects and the kit link is dropped.
  const identities: ResolvedIdentity[] = [
    {
      scope: "brand-kit",
      sitecoreId: brandKitId,
      name: ref.id,
    },
  ];

  return { applied, skipped, identities };
};

/**
 * Compute the plan to converge a brand kit onto `desired`. With
 * `ctx.baselineStorage` plugged in, classifies every kit-level
 * scalar + every per-section / per-field cell three-way (recipe vs
 * tenant vs baseline), merges per `ctx.pushConflictPolicy`, then
 * feeds the merged recipe through `diffBrandKit`. Without baseline
 * storage, degrades to the existing two-way diff.
 *
 * Field-level changes carry their per-cell classification on
 * `change.meta.classification`. Policy-error blocks ride on the lead
 * change (the `stage: "kit"` create when present, else the first
 * field change) so apply can refuse before any writes.
 */
const plan = async (
  desired: BrandKitRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => {
  const internal = await readCurrentInternal(ref, ctx);
  if (internal === null) {
    return resolveMissingCurrentPlan({
      kindName: BRAND_KIT_KIND_NAME,
      ref,
      ctx,
      entityLabel: "Brand kit",
      recreate: () => diffBrandKit(desired, null),
    });
  }
  const current = internal.recipe;

  let baselinePayload: BrandBaselinePayload | undefined;
  if (ctx.baselineStorage) {
    const loaded = await ctx.baselineStorage.load<BrandBaselinePayload>(
      BRAND_KIT_KIND_NAME,
      ctx.environmentName,
      ref.id
    );
    baselinePayload = loaded?.payload;
  }

  const policy: PushConflictPolicy = ctx.pushConflictPolicy ?? "error";
  const classifications = classifyBrandCells(desired, current, baselinePayload);
  const { merged, policyErrors } = mergeBrandByPolicy(desired, current, classifications, policy);

  const basePlan = diffBrandKit(merged, current);

  for (const change of basePlan.changes) {
    if (change.meta?.stage === "field") {
      const section = String(change.meta.section);
      const field = String(change.meta.field);
      const cls = classifications[`sections.${section}.${field}`];
      if (cls) change.meta = { ...change.meta, classification: cls };
    }
  }

  if (policyErrors.length > 0) {
    const carrier = basePlan.changes.find((c) => c.meta?.stage === "kit") ?? basePlan.changes[0];
    if (carrier) {
      carrier.meta = { ...carrier.meta, policyError: true, policyErrors };
    }
  }

  // Canonicalize-repair: a `richArray` field whose LIVE entries lack
  // tags/restrictions was written by an older scai and crashes the
  // Sitecore section render (`entry.tags.map(...)` on undefined). The
  // recipe value usually equals the broken live value, so the field
  // diffs as `noop` and a normal sync never rewrites it. Force an
  // `update` so the next sync repairs the live data — `apply`'s
  // `toApiValue` re-adds `tags: []` / `restrictions: ""`. Idempotent:
  // once the field is canonical, `readCurrentInternal` stops flagging it.
  for (const repair of internal.nonCanonicalRichArray) {
    const path = `sections.${repair.section}.${repair.field}`;
    const existing = basePlan.changes.find((c) => c.path === path);
    if (!existing) {
      basePlan.changes.push({
        kind: "update",
        path,
        summary: `${repair.section} / ${repair.field} (canonicalize richArray shape)`,
        after: repair.value,
        meta: { stage: "field", section: repair.section, field: repair.field },
      });
    } else if (existing.kind === "noop") {
      existing.kind = "update";
      existing.after = repair.value;
      existing.summary = `${repair.section} / ${repair.field} (canonicalize richArray shape)`;
    }
    // An existing create/update already writes the canonical shape via
    // `toApiValue` — leave it untouched.
  }

  return basePlan;
};

/** The `brand-kit` recipe kind. */
export const brandKitKind: RecipeKind<BrandKitRecipe> = {
  name: "brand-kit",
  schema: BrandKitRecipeSchema,
  readCurrent,
  plan,
  apply,
  list,
};
