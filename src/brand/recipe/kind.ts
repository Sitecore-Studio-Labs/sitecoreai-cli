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
  enrichBrandKitWithDocuments,
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
import { synthesizeBrandStubDocument } from "./synthesize-doc";

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

/** Apply a plan — full orchestration: create/ingest the kit, then converge values. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = resolveBrandClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  // Three-way merge gate: refuse before any writes when the planner
  // marked unresolved conflicts under the `"error"` policy.
  const policyErrorChange = plan.changes.find((change) => change.meta?.policyError === true);
  if (policyErrorChange) {
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
  }

  const kitChange = plan.changes.find((change) => change.meta?.stage === "kit");
  const documentChanges = plan.changes.filter((change) => change.meta?.stage === "document");
  const fieldChanges = plan.changes.filter((change) => change.meta?.stage === "field");

  // Resolve the kit id — running create → ingest → enrich when the plan
  // calls for it.
  let brandKitId: string;
  if (kitChange) {
    // --no-enrich + creating a fresh kit is incoherent: sections only
    // exist after enrichment, and PATCHes can't land without sections.
    // Refuse up front with the explanation rather than silently
    // creating a bare kit + reporting every field skipped.
    if (ctx.skipEnrichment) {
      throw createScaiError(
        `Brand kit "${ref.id}" does not exist yet — \`--no-enrich\` cannot bootstrap a new kit because Sitecore's Brand Management API only creates sections via the enrichment pipeline.`,
        "INPUT_INVALID",
        {
          hint: "Run once without `--no-enrich` to seed the kit, then re-run with `--no-enrich` for fast iteration on field values.",
        }
      );
    }
    const name = String(kitChange.after);
    const description = kitChange.meta?.description as string | undefined;
    const industry = kitChange.meta?.industry as string | undefined;
    const operatorDocuments = documentChanges
      .map((change) => change.meta?.document as BrandDocument | undefined)
      .filter((doc): doc is BrandDocument => doc !== undefined);

    // Sitecore's Brand Management API has no "create section" endpoint
    // — sections only appear after EnrichSectionsPipeline runs over a
    // document. If the recipe declares field values but the operator
    // shipped no source doc, every field write would land on a kit
    // with zero sections and get marked `skipped` by the field loop
    // below (the live kit would end up blank). Synthesize a stub PDF
    // naming the declared sections so the canonical 7-section set
    // gets created and our PATCH calls have somewhere to land.
    const fieldSectionNames = Array.from(
      new Set(
        fieldChanges
          .map((change) => change.meta?.section)
          .filter((section): section is string => typeof section === "string")
      )
    );
    const synthesizeStub = operatorDocuments.length === 0 && fieldSectionNames.length > 0;
    const documents: BrandDocument[] = synthesizeStub
      ? [
          (() => {
            const stub = synthesizeBrandStubDocument({
              brandKitName: name,
              sectionNames: fieldSectionNames,
            });
            return {
              kind: "url",
              url: stub.url,
              title: stub.title,
              tags: stub.tags,
            };
          })(),
        ]
      : operatorDocuments;

    if (documents.length > 0) {
      ctx.logger?.info(
        synthesizeStub
          ? `Seeding brand kit "${name}" — no operator document, synthesizing a stub PDF naming ${fieldSectionNames.length} section(s) so EnrichSections produces the canonical section set. Field values then converge via PATCH (paid, ~5-15 min).`
          : `Seeding brand kit "${name}" — create -> upload ${documents.length} doc(s) -> publish -> ingest -> enrich (paid, ~5-15 min).`
      );
      // `seedBrandKit` accepts the recipe-shaped `BrandDocument` union
      // directly; registry-file variants without a resolved URL get
      // rejected there with a clear hint. Pulling that translation
      // up into the kind runner would duplicate the rejection seam.
      const result = await seedBrandKit({
        client,
        name,
        documents,
        description,
        industry,
        signal: ctx.signal,
        onProgress: (event) =>
          ctx.logger?.info(`  [+${event.elapsedSec}s] ${event.stage}: ${event.message}`),
      });
      brandKitId = result.kit.id;
    } else {
      const kit = await createBrandKit({ client, name, description, industry, signal: ctx.signal });
      brandKitId = kit.id;
    }
    applied.push(kitChange, ...documentChanges);
  } else {
    // Prefer baseline-stored tenant id over name match — robust to
    // kit name edits between pushes.
    let priorTenantId: string | undefined;
    if (ctx.baselineStorage) {
      try {
        const prior = await ctx.baselineStorage.load<BrandBaselinePayload>(
          BRAND_KIT_KIND_NAME,
          ctx.environmentName,
          ref.id
        );
        priorTenantId = prior?.payload?.tenantId;
      } catch {
        // best-effort
      }
    }
    const found = await findKitByIdOrName(client, ref, priorTenantId, ctx.signal);
    if (!found) {
      throw createScaiError(`Brand kit "${ref.id}" not found`, "INPUT_INVALID", {
        hint: "Push a recipe with documents to create the kit, or check the name.",
      });
    }
    brandKitId = found.id;
  }

  // Self-heal path for stuck kits: an existing kit may have been
  // previously created without going through the AI enrichment
  // pipeline (older scai missing the synthesize-stub feature, a
  // direct `createBrandKit` call, or an enrichment that produced
  // sections-without-fields). The field-PATCH loop below silently
  // skips every write against such a kit.
  //
  // We trigger self-heal when an indexFields probe finds NONE of
  // the section/field pairs the writes target. That covers both
  // shapes of stuck kit (zero sections, sections-but-no-fields) and
  // sections-with-wrong-names — without firing on a partially
  // populated kit where some targets already exist.
  const writeKeys = fieldChanges
    .filter((c) => c.kind === "create" || c.kind === "update")
    .map((c) => ({
      section: typeof c.meta?.section === "string" ? c.meta.section : "",
      field: typeof c.meta?.field === "string" ? c.meta.field : "",
    }))
    .filter((k) => k.section && k.field);
  const sectionsTargetedByWrites = Array.from(new Set(writeKeys.map((k) => k.section)));
  if (writeKeys.length > 0) {
    const initialIndex = await indexFields(client, brandKitId, ctx.signal);
    const anyTargetReachable = writeKeys.some((k) =>
      initialIndex.has(fieldKey(k.section, k.field))
    );
    if (!anyTargetReachable) {
      if (ctx.skipEnrichment) {
        // Operator asked to skip enrichment; surface the diagnostic
        // so the "Applied 0 / N skipped" outcome is explainable, but
        // don't trigger the self-heal pipeline they opted out of.
        ctx.logger?.info(
          `Brand kit "${ref.id}" exists but none of the ${sectionsTargetedByWrites.length} recipe section(s) are reachable on the live kit (live field count: ${initialIndex.size}). \`--no-enrich\` is set, so the self-heal enrichment cycle is skipped — every field write will skip. Re-run without \`--no-enrich\` to populate the section structure.`
        );
      } else {
        ctx.logger?.info(
          `Brand kit "${ref.id}" exists but none of the ${sectionsTargetedByWrites.length} recipe section(s) are reachable on the live kit (live field count: ${initialIndex.size}) — synthesizing a stub PDF and running enrichment on the existing kit id (paid, ~5-15 min).`
        );
        const stub = synthesizeBrandStubDocument({
          brandKitName: ref.id,
          sectionNames: sectionsTargetedByWrites,
        });
        await enrichBrandKitWithDocuments({
          client,
          brandKitId,
          name: ref.id,
          documents: [
            {
              kind: "url",
              url: stub.url,
              title: stub.title,
              tags: stub.tags,
            },
          ],
          signal: ctx.signal,
          onProgress: (event) =>
            ctx.logger?.info(`  [+${event.elapsedSec}s] ${event.stage}: ${event.message}`),
        });
      }
    }
  }

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
      // with AI-generated content from the stub PDF — the "ruins half
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
    if (applied.filter((c) => c.meta?.stage === "field").length === 0 && skipped.length > 0) {
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
    }
  }
  for (const change of fieldChanges) {
    if (change.kind === "noop") skipped.push(change);
  }

  // Three-way merge baseline capture. Re-read live state so the
  // baseline reflects what actually landed (including
  // enrichment-authored values on a freshly-seeded kit) rather than
  // trust desired, which may have diverged at the field-skip path
  // when the section/field structure didn't match.
  if (ctx.baselineStorage) {
    const snapshot = await readCurrent(ref, ctx);
    if (snapshot) {
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
    }
  }

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
