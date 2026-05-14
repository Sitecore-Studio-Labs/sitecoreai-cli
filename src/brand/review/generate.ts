import { requestBrandApi, type BrandApiClientOptions } from "../api/client";
import {
  BRAND_REVIEW_BASE_PATH,
  type BrandReviewInput,
  type BrandReviewResult,
  type BrandReviewScore,
  type BrandReviewSectionResult,
  type BrandReviewSelector,
} from "../api/types";
import type { components as BrandReviewComponents } from "../api/schema.brand-review";

type RawRequest = BrandReviewComponents["schemas"]["GenerateBrandReviewModelRequest"];
type RawResponse = BrandReviewComponents["schemas"]["GenerateBrandReviewModelResponse"];
type RawSectionReview = BrandReviewComponents["schemas"]["SectionReview"];
type RawFieldReview = BrandReviewComponents["schemas"]["FieldReview"];

export interface GenerateBrandReviewOptions {
  client: BrandApiClientOptions;
  input: BrandReviewInput;
  selector: BrandReviewSelector;
  signal?: AbortSignal;
}

const clampScore = (value: number | undefined): BrandReviewScore => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as BrandReviewScore;
};

/**
 * Build the API's `input` map from scai's caller-facing input shape.
 *
 * The Brand Review API accepts a flexible map of input types — raw
 * text, files, base64 payloads, etc. scai's headline path is text
 * content, which lands under the `content` key (matches the
 * documented example in the OpenAPI spec). Callers can layer
 * arbitrary additional fields via `input.extra` for advanced cases
 * (e.g. `{ document: ExtractableFile }`) without dropping to the
 * raw transport.
 */
const buildApiInput = (input: BrandReviewInput): RawRequest["input"] => {
  const result: Record<string, unknown> = { ...(input.extra ?? {}) };
  if (input.text !== undefined) {
    result.content = input.text;
  }
  return result as RawRequest["input"];
};

/**
 * Flatten the API's `{ reviews: [{ sectionId, score, fields: [...] }] }`
 * into scai's `BrandReviewSectionResult[]`. Section-level entries
 * come first, then field-level entries within each section. The
 * field-level rows carry their own scores so formatters (SARIF
 * especially) can drive per-field findings without consumers
 * walking the nested structure.
 *
 * The API exposes a singular `suggestion` string per section/field;
 * we wrap it in an array for forward compatibility with the
 * documented "improvement suggestions" plural — once Sitecore makes
 * that a list, no breaking change on scai's side.
 */
const flattenSectionReview = (review: RawSectionReview): BrandReviewSectionResult[] => {
  const rows: BrandReviewSectionResult[] = [];
  rows.push({
    section: review.sectionId ?? "(unknown)",
    score: clampScore(review.score),
    explanation: review.reason,
    suggestions: review.suggestion ? [review.suggestion] : undefined,
  });
  for (const field of review.fields ?? []) {
    rows.push({
      section: review.sectionId ?? "(unknown)",
      field: field.fieldId,
      score: clampScore(field.score),
      explanation: field.reason,
      suggestions: field.suggestion ? [field.suggestion] : undefined,
    });
  }
  return rows;
};

/**
 * Conservative overall-score aggregation. The API does NOT return a
 * top-level overall score; scai derives one as the minimum across
 * every section + field score so a CI threshold gate reacts to the
 * worst finding rather than the average (which would hide outliers).
 * Empty responses default to 5 (no findings → max alignment).
 */
const aggregateOverall = (sectionResults: readonly BrandReviewSectionResult[]): BrandReviewScore => {
  if (sectionResults.length === 0) return 5;
  let lowest: BrandReviewScore = 5;
  for (const row of sectionResults) {
    if (row.score < lowest) {
      lowest = row.score;
    }
  }
  return lowest;
};

/**
 * Generate a Brand Review for the given content against a brand kit.
 *
 * Wraps `POST /api/skills/v1/brandreview/generate`. Sync (~5s); no
 * batching server-side. The CLI's `scai brand review --glob` is a
 * client-side fan-out over this primitive (`runBrandReview` in
 * `src/brand/tasks/review.ts`).
 *
 * Selector quirks worth knowing:
 *   - `brandKitId` is sent as `brandkitId` (lowercase 'k') over the
 *     wire — the API uses the lowercase spelling.
 *   - `sections` are objects with UUID `sectionId` + optional
 *     `fieldIds`, not section name strings. Name → UUID lookup lands
 *     when the Brand Management read primitives ship.
 */
export const generateBrandReview = async (
  options: GenerateBrandReviewOptions
): Promise<BrandReviewResult> => {
  const body: RawRequest = {
    brandkitId: options.selector.brandKitId,
    input: buildApiInput(options.input),
    sections: options.selector.sections?.length ? options.selector.sections : undefined,
  };

  const response = await requestBrandApi<RawResponse>(options.client, {
    basePath: BRAND_REVIEW_BASE_PATH,
    path: "/api/skills/v1/brandreview/generate",
    method: "POST",
    body,
    signal: options.signal,
  });

  const sectionResults: BrandReviewSectionResult[] = [];
  for (const review of response.reviews ?? []) {
    sectionResults.push(...flattenSectionReview(review));
  }

  return {
    overallScore: aggregateOverall(sectionResults),
    sectionResults,
    raw: response,
  };
};

// Re-export internals for test purposes (and for downstream callers
// that want to inspect the aggregation behavior directly).
export { aggregateOverall as _aggregateOverall };
export type { RawSectionReview, RawFieldReview };
