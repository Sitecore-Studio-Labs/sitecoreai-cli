/**
 * `BrandKitRecipe` — the declarative definition of a Sitecore Brand
 * brand kit.
 *
 * This schema is the single source of truth for the `brand-kit` recipe
 * kind: it validates recipe files, drives the `sync` CLI, and becomes
 * the MCP tool input schema. Keep the `.describe()` text accurate — the
 * model reads it.
 *
 * Two authoring shapes share this schema:
 *
 *   - **scai-native** — flat object with `name`, `documents`, `sections`.
 *     No `kind` / `schemaVersion` / `handle`. Used by hand-authored
 *     `.brandkit.yaml` files and the `scai brand sync pull` capture
 *     path. Stays valid: the discriminator fields are optional here.
 *   - **registry-superset** — the richer shape the `@registry`
 *     `sitecore-recipes.ts` exports use: adds `kind: "brandkit"`,
 *     `schemaVersion: "1"`, `handle`, `displayName`, and a
 *     discriminated `documents[]` shape (`url` | `registry-file`)
 *     with `tags` / `sections` hints per document. The orchestrator
 *     passes recipes through unchanged from the registry to scai;
 *     scai's parser accepts the extra fields without stripping them.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { z } from "zod";

const HANDLE_PATTERN = /^[a-z][a-z0-9-]*@\d+$/;

/**
 * An `array`-field entry: a single `{name}` object slot. Server-assigned
 * `id` echoed back on read; omit when authoring.
 *
 * Used for Sitecore's flat list fields — Dos and dont's, Checklist
 * values, Grammar guidelines values, Visual Guidelines > Logo
 * guidelines / Colour palettes, Brand Context > Brand concept. Mirrors
 * `BrandArrayEntry` in the registry's `sitecore-recipes.ts` and
 * `BrandKitArrayEntry` in this package's API client layer.
 */
export const BrandArrayEntrySchema = z.object({
  name: z.string().min(1).describe("The entry's text."),
  id: z
    .string()
    .optional()
    .describe("Server-assigned UUID. Omit when authoring; the API fills it in."),
});

/**
 * A `richArray`-field entry: text plus optional tags and a constraint.
 * Used for Tone scenarios + Image style scenarios (Sitecore UI labels
 * `name`→"Instructions" and `tags`→"Keys").
 */
export const BrandRichEntrySchema = z.object({
  name: z.string().min(1).describe('The entry\'s text. (Sitecore UI label: "Instructions".)'),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      'Free-form tags, e.g. "Marketing", "Claims", "Self-Serve". (Sitecore UI label: "Keys".)'
    ),
  restrictions: z
    .string()
    .optional()
    .describe('Per-scenario constraint, e.g. "Never use scarcity in marketing copy".'),
  id: z
    .string()
    .optional()
    .describe("Server-assigned UUID. Omit when authoring; the API fills it in."),
});

/**
 * A glossary translation row. The `Glossary and Localization` section's
 * fields are dynamic — one per glossary term — and each field's value
 * is an array of these rows (one per locale). The section's base
 * language belongs in `BrandKitRecipe.sectionProperties[…].sourceLanguage`.
 */
export const BrandGlossaryEntrySchema = z.object({
  term: z.string().min(1).describe("The translated term for this locale."),
  locale: z.string().min(1).describe("BCP-47 locale tag, e.g. `en-US`, `ja-JP`, `de-DE`."),
  displayName: z
    .string()
    .optional()
    .describe('Human label for the locale, e.g. "Japanese (Japan)". UI hint.'),
  id: z
    .string()
    .optional()
    .describe("Server-assigned UUID. Omit when authoring; the API fills it in."),
});

/**
 * A brand-kit field value. The valid shape depends on the live field's
 * `type` — `text` → string, `array` → `BrandArrayEntry[]`, `richArray`
 * → `BrandRichEntry[]`. Glossary fields are special: dynamic per-term
 * with `BrandGlossaryEntry[]` values. Sitecore returns HTTP 422 if you
 * PATCH a mismatched shape (e.g. a string into an `array` field).
 *
 * The earlier `string[]` member of this union was empirically wrong —
 * `array` is object-shaped on the wire, not string-shaped — and made
 * every list-field push 422.
 */
export const BrandFieldValueSchema = z
  .union([
    z.string(),
    z.array(BrandArrayEntrySchema),
    z.array(BrandRichEntrySchema),
    z.array(BrandGlossaryEntrySchema),
  ])
  .describe(
    "A text value, an object-array of `{name}` entries, a richArray of `{name, tags?, restrictions?}` entries, or a glossary array of `{term, locale, displayName?}` rows."
  );

/**
 * Section-level metadata that Sitecore stores alongside the field
 * dictionary. Today the only load-bearing slot is `sourceLanguage`,
 * the Glossary section's base/default-language tag (BCP-47).
 */
export const BrandKitSectionPropertiesSchema = z.object({
  sourceLanguage: z
    .string()
    .optional()
    .describe(
      "BCP-47 default/base language tag. On `Glossary and Localization`, names the language entries default to when no per-row locale matches."
    ),
});

/**
 * Canonical Sitecore AI brand-kit section names — verified empirically
 * 2026-06-02 against the live `Sync` brand kit. Earlier snapshots of
 * this list were wrong on three names ("Do's and Don'ts" → "Dos and
 * Dont's", "Grammar Checklists" → "Grammar Guidelines") and missing
 * two sections ("Image Style", "Checklist"); recipes built against
 * those names PATCH-skipped silently.
 *
 * Mirrors `BRAND_KIT_CANONICAL_SECTIONS` in the registry's recipe
 * definitions. Exported so callers building recipes have a stable
 * list to bias `documents[].sections` against.
 */
export const BRAND_KIT_CANONICAL_SECTIONS = [
  "Brand Context",
  "Global Goals",
  "Tone of Voice",
  "Dos and Dont's",
  "Visual Guidelines",
  "Image Style",
  "Grammar Guidelines",
  "Checklist",
  "Glossary and Localization",
] as const;
export type BrandKitCanonicalSection = (typeof BRAND_KIT_CANONICAL_SECTIONS)[number];

/**
 * Optional ingestion hints — `tags` and `sections` — shared by both
 * document variants. Hoisted into a shape so the URL and registry-file
 * shapes stay in lockstep without duplicating field-by-field.
 */
const DocumentHints = {
  title: z.string().optional().describe('Document title. Defaults to "brand guidelines".'),
  summary: z.string().optional().describe("Short document summary."),
  tags: z
    .array(z.string())
    .optional()
    .describe('Free-form tags surfaced to the EnrichSections pipeline (e.g. "voice").'),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      'Canonical section names to bias ingestion toward (e.g. ["Tone of Voice"]). Prefer values from BRAND_KIT_CANONICAL_SECTIONS.'
    ),
};

/**
 * A brand document referenced by URL. Sitecore's Documents API fetches
 * the URL server-side and copies the bytes into MMS. The default
 * variant — what `scai brand sync pull` emits when capturing a live
 * kit.
 */
export const BrandUrlDocumentSchema = z.object({
  kind: z.literal("url"),
  url: z
    .string()
    .min(1)
    .describe("Publicly reachable URL of a brand document (PDF). Sitecore fetches it server-side."),
  ...DocumentHints,
});

/**
 * A brand document stored alongside the recipe in the registry repo.
 * The `path` is relative to the recipe file's directory. scai itself
 * does **not** upload these — the Sitecore Documents API has no
 * working bytes-upload path (see
 * `src/brand/documents/upload.ts::LOCAL_UPLOAD_UNSUPPORTED_MESSAGE`),
 * so the orchestrator (or whoever owns the recipe before scai sees
 * it) MUST translate `registry-file` entries to `url` entries
 * pointing at an HTTP-reachable host before invoking `scai brand
 * sync push`. The seed runner rejects unresolved `registry-file`
 * documents with a clear hint; this stays in the schema as an
 * authoring-time shape so registry-side recipes round-trip cleanly.
 */
export const BrandRegistryFileDocumentSchema = z.object({
  kind: z.literal("registry-file"),
  path: z.string().min(1).describe("Path to the document, relative to the recipe file."),
  ...DocumentHints,
});

/**
 * A brand document to ingest. Two variants — `{ kind: "url", url }` and
 * `{ kind: "registry-file", path }` — sharing optional `title` /
 * `summary` / `tags` / `sections` ingestion hints.
 *
 * Back-compat: scai-native recipes that pre-date the discriminator wrote
 * documents as the flat `{ url, title?, summary? }` shape. The
 * `z.preprocess` step defaults a missing `kind` to `"url"` whenever
 * `url` is present, so legacy recipes keep parsing without a migration
 * step. Zod 4's discriminated unions require the discriminator to be
 * present BEFORE routing, so `.default("url")` inline on the literal
 * doesn't work — preprocess is the correct seam.
 */
export const BrandDocumentSchema = z.preprocess(
  (raw) => {
    if (
      raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("kind" in (raw as Record<string, unknown>)) &&
      "url" in (raw as Record<string, unknown>)
    ) {
      return { kind: "url", ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.discriminatedUnion("kind", [BrandUrlDocumentSchema, BrandRegistryFileDocumentSchema])
);

/** The full brand-kit recipe. */
export const BrandKitRecipeSchema = z.object({
  /**
   * Registry-superset discriminator — `"brandkit"`. Optional: scai-
   * native YAML/JSON recipes pre-date this field and don't carry it.
   * Defaulting in (rather than requiring) keeps the legacy parse
   * path intact. Registry-authored recipes set this explicitly.
   */
  kind: z.literal("brandkit").optional(),
  /**
   * Registry-superset schema version pin — `"1"`. Optional for the
   * same back-compat reason as `kind`. When set, the registry's
   * discriminated-union loader picks this recipe up.
   */
  schemaVersion: z.literal("1").optional(),
  /**
   * Stable handle of the form `<kebab-name>@<major>` (e.g.
   * `acme-brand@1`). Registry-side identifier used to wire brand
   * kits to themes. Optional in scai because scai-native recipes
   * identify kits by `name`, not handle.
   */
  handle: z
    .string()
    .regex(HANDLE_PATTERN, {
      message: "handle must match `<kebab-name>@<major>` (e.g. acme-brand@1)",
    })
    .optional()
    .describe("Stable handle `<kebab-name>@<major>`. Required for registry-authored recipes."),
  name: z
    .string()
    .min(1)
    .describe("Display name of the brand kit. Identifies the kit when pushing."),
  /**
   * Author-facing label, mirrors the registry's superset. When absent
   * the registry's loader treats it as identical to `name`; scai's
   * `apply()` likewise ignores it (the API has no separate display
   * name slot beyond `name`).
   */
  displayName: z.string().min(1).optional().describe("Author-facing label; defaults to `name`."),
  description: z.string().optional().describe("Human description of the kit."),
  industry: z.string().optional().describe('Industry label, e.g. "retail" or "developer-tools".'),
  logo: z
    .string()
    .optional()
    .describe(
      "URL of the brand kit's logo image (PNG per the Sitecore API). Rendered directly by the brand-kit UI, so any publicly reachable image URL works. Omit to leave the live logo unmanaged."
    ),
  documents: z
    .array(BrandDocumentSchema)
    .default([])
    .describe(
      "Brand documents to ingest. On push, when the kit has no populated sections, each is uploaded and run through the ingestion + enrichment pipelines. `registry-file` variants must be translated to `url` variants before scai sees the recipe — the Sitecore Documents API has no working bytes-upload path."
    ),
  sections: z
    .record(z.string(), z.record(z.string(), BrandFieldValueSchema))
    .default({})
    .describe(
      "Desired field values, keyed by section name then field name. Prefer canonical names from BRAND_KIT_CANONICAL_SECTIONS for the outer key. Sections and fields are created by enrichment; push converges their values. `Glossary and Localization` is a special case: its inner keys are dynamic (one per glossary term) and the value is `BrandGlossaryEntry[]`; the section's base language lives on `sectionProperties`."
    ),
  sectionProperties: z
    .record(z.string(), BrandKitSectionPropertiesSchema)
    .default({})
    .describe(
      "Per-section metadata sidecar (keyed by section name). Currently load-bearing only for `Glossary and Localization`'s `sourceLanguage`."
    ),
});

/** A validated brand-kit recipe (parsed form — defaults materialised). */
export type BrandKitRecipe = z.infer<typeof BrandKitRecipeSchema>;

/**
 * Input alias — the shape an *author* writes. Same as
 * `BrandKitRecipe` minus the `.default(...)` clauses; useful for
 * loaders and TypeScript-authored recipe modules.
 */
export type BrandKitRecipeInput = z.input<typeof BrandKitRecipeSchema>;

/** A brand-kit field value (text / array entries / rich entries / glossary entries). */
export type BrandFieldValue = z.infer<typeof BrandFieldValueSchema>;

/** A single `array`-field entry (object with `name`). */
export type BrandArrayEntry = z.infer<typeof BrandArrayEntrySchema>;

/** A single `richArray`-field entry (name + optional tags + restrictions). */
export type BrandRichEntry = z.infer<typeof BrandRichEntrySchema>;

/** A single glossary-and-localization translation row. */
export type BrandGlossaryEntry = z.infer<typeof BrandGlossaryEntrySchema>;

/** Per-section metadata (currently only `sourceLanguage`). */
export type BrandKitSectionProperties = z.infer<typeof BrandKitSectionPropertiesSchema>;

/** A brand document reference within a recipe (URL or registry-file). */
export type BrandDocument = z.infer<typeof BrandDocumentSchema>;

/** A URL-form brand document (post-parse — `kind` is the literal). */
export type BrandUrlDocument = z.infer<typeof BrandUrlDocumentSchema>;

/** A registry-file-form brand document (post-parse — `kind` is the literal). */
export type BrandRegistryFileDocument = z.infer<typeof BrandRegistryFileDocumentSchema>;
