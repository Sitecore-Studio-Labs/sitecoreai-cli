/**
 * Hand-typed shapes for the Sitecore AI Skills APIs (Brand Management
 * + Brand Review). These mirror the documented endpoints at
 * api-docs.sitecore.com/ai-skills. They are intentionally minimal —
 * only fields scai consumes — and will be replaced by codegen from
 * the vendored OpenAPI YAML in a follow-up commit once the SPA's raw
 * YAML fetch story is sorted out.
 */

/** Hostname for the AI Skills APIs. Same edge host as the Publishing API. */
export const AI_SKILLS_API_HOST = "https://edge-platform.sitecorecloud.io";

/** Base path for the Brand Management API. */
export const BRAND_MANAGEMENT_BASE_PATH = "/stream/ai-brands-api";

/** Base path for the Brand Review API. */
export const BRAND_REVIEW_BASE_PATH = "/stream/ai-skills-api";

/**
 * Predefined brand kit sections every kit is created with (empty by
 * default; populated via Documents + Pipeline APIs or hand-authored
 * via Brand Management subsection writes). The full set isn't
 * exhaustively documented; treat this as the validated subset and
 * accept unknown section names from the API.
 */
export type BrandKitSectionName =
  | "Brand Context"
  | "Global Goals"
  | "Tone of Voice"
  | "Glossary and Localization"
  | "Do's and Don'ts"
  | "Grammar Checklists"
  | "Visual Guidelines"
  | (string & {}); // accept future sections without losing autocomplete

/** Compliance score domain documented in the Brand Review API. */
export type BrandReviewScore = 1 | 2 | 3 | 4 | 5;

export interface BrandReviewSectionResult {
  /** Section the result applies to. */
  section: BrandKitSectionName;
  /** Optional subsection (field) within the section. */
  field?: string;
  /** 1..5; 5 = strongest alignment with the brand guidelines. */
  score: BrandReviewScore;
  /** Why this score was assigned. */
  explanation?: string;
  /** Improvement suggestions, if any. */
  suggestions?: string[];
}

export interface BrandReviewResult {
  /** Overall score across all evaluated sections. */
  overallScore: BrandReviewScore;
  /** Per-section / per-field breakdown. */
  sectionResults: BrandReviewSectionResult[];
  /** Free-form server fields scai doesn't model yet. */
  raw?: Record<string, unknown>;
}

/**
 * Input content to evaluate. Brand Review accepts text, images, PDFs,
 * Markdown, JSON, etc. — the request shape is "content in the request
 * body". scai's high-level primitive only models text + markdown for
 * the first cut; other formats land in follow-up slices with their
 * own factories.
 */
export interface BrandReviewInput {
  /** Free-text or markdown content to evaluate. */
  text: string;
  /** Optional content format hint surfaced to the API. */
  format?: "text" | "markdown" | "json";
  /** Optional caller-supplied label (e.g. source file path) — purely for downstream aggregation. */
  label?: string;
}

export interface BrandReviewSelector {
  /** Brand kit to evaluate against. */
  brandKitId: string;
  /** Optional narrowing to specific sections. Empty/undefined = all sections. */
  sections?: BrandKitSectionName[];
}
