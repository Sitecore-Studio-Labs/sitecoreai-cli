/**
 * Convenience types layered over the codegen'd OpenAPI schemas for the
 * Sitecore AI Skills APIs (Brand Management + Brand Review). The raw
 * schemas are at `./schema.brand-management.d.ts` and
 * `./schema.brand-review.d.ts`; these aliases give scai's library
 * surface a stable, callable shape without exposing the underlying
 * `components["schemas"][…]` indirection on every property access.
 *
 * Where the API's wire shape doesn't match what callers want
 * (response → flattened section/field results, free-text input →
 * keyed `input` map, etc.), the mapping happens in `generate.ts` and
 * sibling primitives. These types stay close to what consumers see.
 */
import type { components as BrandReviewComponents } from "./schema.brand-review";

/** Hostname for the AI Skills APIs. Same edge host as the Publishing API. */
export const AI_SKILLS_API_HOST = "https://edge-platform.sitecorecloud.io";

/** Base path for the Brand Management API. */
export const BRAND_MANAGEMENT_BASE_PATH = "/stream/ai-brands-api";

/** Base path for the Brand Review API. */
export const BRAND_REVIEW_BASE_PATH = "/stream/ai-skills-api";

/**
 * Predefined brand kit section names. The Sitecore docs reference
 * "Brand Context", "Global Goals", "Tone of Voice", and "Glossary and
 * Localization" as defaults; other sections like "Do's and Don'ts",
 * "Grammar Checklists", and "Visual Guidelines" appear in the Brand
 * Review docs. Kept as a string-and-known-literals union for
 * autocomplete; the API addresses sections by UUID, not by name —
 * scai's caller-facing layer maps names ↔ IDs in a follow-up slice
 * once Brand Management read primitives land.
 */
export type BrandKitSectionName =
  | "Brand Context"
  | "Global Goals"
  | "Tone of Voice"
  | "Glossary and Localization"
  | "Do's and Don'ts"
  | "Grammar Checklists"
  | "Visual Guidelines"
  | (string & {});

/** Compliance score domain documented in the Brand Review API. */
export type BrandReviewScore = 1 | 2 | 3 | 4 | 5;

/**
 * Section selector for Brand Review.
 *
 *   - `sectionId` (UUID) is required.
 *   - `fieldIds` narrows to specific subsections within the section.
 *     Empty / unset → every field in the section is evaluated.
 *
 * Mirrors the API's `Section` schema 1:1.
 */
export type BrandReviewSectionSelector = BrandReviewComponents["schemas"]["Section"];

/**
 * Flattened result for one section (or one field within a section) of
 * a Brand Review. scai's formatters consume this shape uniformly;
 * `generate.ts` normalizes the API's nested
 * `{ reviews: [{ sectionId, score, fields: [{ fieldId, score }] }] }`
 * structure into a flat list of `BrandReviewSectionResult`s — one
 * per section + one per field — so per-field findings drive SARIF /
 * JSON entries without requiring consumers to walk nested arrays.
 *
 * `section` carries the UUID until name lookup lands; `field` is the
 * subsection UUID. Suggestions are wrapped in an array for forward
 * compatibility (the API exposes a single `suggestion` string today).
 */
export interface BrandReviewSectionResult {
  /** Section UUID (or, eventually, resolved name). */
  section: string;
  /** Subsection (field) UUID, present for per-field results. */
  field?: string;
  /** 1..5; 5 = strongest alignment with the brand guidelines. */
  score: BrandReviewScore;
  /** Why this score was assigned. */
  explanation?: string;
  /** Improvement suggestions. */
  suggestions?: string[];
}

export interface BrandReviewResult {
  /**
   * scai-computed headline score for the run, derived as the minimum
   * across every section + field score in the response. Conservative
   * by design — a CI threshold gate should react to the worst finding,
   * not the average. The Brand Review API does NOT return an overall
   * score; this is a client-side aggregation.
   */
  overallScore: BrandReviewScore;
  /**
   * Flat list: one entry per section, plus one entry per field, in
   * the order the API returned them. Sections come before their
   * fields.
   */
  sectionResults: BrandReviewSectionResult[];
  /** Raw server payload — escape hatch for inspection/debugging. */
  raw?: BrandReviewComponents["schemas"]["GenerateBrandReviewModelResponse"];
}

/**
 * Caller-facing input shape for one review call.
 *
 *   - `text` is the convenience path for raw text / markdown / JSON
 *     content (the headline use case). When set, scai sends the API's
 *     `input` map with a single `"content"` key.
 *   - `extra` lets advanced callers add arbitrary `input.*` keys
 *     (e.g. file refs per the `ExtractableFile` schema) without
 *     dropping to the raw transport.
 *   - `label` is scai-local — used for downstream formatting and
 *     SARIF `physicalLocation` URIs. NOT sent to the API.
 */
export interface BrandReviewInput {
  text?: string;
  /** Free-form additional `input.*` fields per the API's flexible-map shape. */
  extra?: Record<string, unknown>;
  /** Caller-supplied label, e.g. file path or test name. */
  label?: string;
}

/** Selector targeting a specific brand kit + optional narrowing. */
export interface BrandReviewSelector {
  brandKitId: string;
  /**
   * Restrict the evaluation to these sections (and optionally to
   * specific fields within them). Empty/undefined → evaluate against
   * every section in the brand kit.
   *
   * Note: sectionId / fieldIds are UUIDs (see Brand Management API).
   * scai's CLI exposes `--section-id` directly; friendly name lookup
   * lands once the Brand Management read primitives ship.
   */
  sections?: BrandReviewSectionSelector[];
}
