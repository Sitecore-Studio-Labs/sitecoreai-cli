import { requestBrandApi, type BrandApiClientOptions } from "../api/client";
import {
  BRAND_REVIEW_BASE_PATH,
  type BrandReviewInput,
  type BrandReviewResult,
  type BrandReviewSectionResult,
  type BrandReviewSelector,
  type BrandReviewScore,
} from "../api/types";

export interface GenerateBrandReviewOptions {
  client: BrandApiClientOptions;
  input: BrandReviewInput;
  selector: BrandReviewSelector;
  signal?: AbortSignal;
}

/**
 * Sitecore's documented Brand Review request/response is a single
 * synchronous POST to `/api/skills/v1/brandreview/generate`. The full
 * request schema isn't on the public docs page (only the prose
 * description); these are scai's best-effort field names based on the
 * documented behavior. They're isolated in this primitive so the
 * mapping can be tightened once the OpenAPI YAML is vendored without
 * disturbing callers.
 */
interface RawReviewRequest {
  brandKitId: string;
  sections?: string[];
  content: {
    text: string;
    format?: string;
    label?: string;
  };
}

interface RawReviewResponseSection {
  section?: string;
  field?: string;
  score?: number;
  explanation?: string;
  suggestions?: string[];
}

interface RawReviewResponse {
  overallScore?: number;
  sectionResults?: RawReviewResponseSection[];
  [key: string]: unknown;
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

const normalizeSection = (raw: RawReviewResponseSection): BrandReviewSectionResult => ({
  section: raw.section ?? "Unknown",
  field: raw.field,
  score: clampScore(raw.score),
  explanation: raw.explanation,
  suggestions: raw.suggestions,
});

/**
 * Generate a Brand Review for the given content against a brand kit.
 *
 * Wraps `POST /api/skills/v1/brandreview/generate`. Sync (~5s); no
 * batching server-side. The CLI's `scai brand review --glob` is a
 * client-side fan-out over this primitive.
 */
export const generateBrandReview = async (
  options: GenerateBrandReviewOptions
): Promise<BrandReviewResult> => {
  const body: RawReviewRequest = {
    brandKitId: options.selector.brandKitId,
    sections: options.selector.sections?.length ? options.selector.sections : undefined,
    content: {
      text: options.input.text,
      format: options.input.format,
      label: options.input.label,
    },
  };

  const response = await requestBrandApi<RawReviewResponse>(options.client, {
    basePath: BRAND_REVIEW_BASE_PATH,
    path: "/api/skills/v1/brandreview/generate",
    method: "POST",
    body,
    signal: options.signal,
  });

  return {
    overallScore: clampScore(response.overallScore),
    sectionResults: (response.sectionResults ?? []).map(normalizeSection),
    raw: response,
  };
};
