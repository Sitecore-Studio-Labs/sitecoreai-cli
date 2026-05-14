import type { BrandReviewScore, BrandReviewSectionResult } from "../api/types";
import { scoreToSarifLevel, type ReviewOutcome } from "./outcomes";

/**
 * Minimal SARIF 2.1.0 representation for a batch brand review.
 * GitHub's SARIF uploader (`github/codeql-action/upload-sarif`) tolerates
 * extra fields and missing optional ones, so the shape here keeps to
 * the fields that drive PR annotations: `ruleId`, `level`, `message`,
 * and a `physicalLocation` pointing at the source file.
 *
 * Threshold filtering: if `threshold` is provided, only section
 * results whose score is strictly less than the threshold become
 * SARIF entries. When unset, scores of 4 and 5 are omitted (well-
 * aligned content shouldn't fill PRs with noise) — scores 1–3 are
 * always emitted as findings.
 *
 * Per-file errors (API failures) are emitted as a synthetic
 * `brand/api-error` rule so consumers don't have to cross-reference
 * the SARIF run with the CLI exit log.
 */
export interface SarifReport {
  version: "2.1.0";
  $schema: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
}

interface SarifDriver {
  name: string;
  version: string;
  informationUri?: string;
  rules: SarifRule[];
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  help?: { text: string };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: { artifactLocation: { uri: string } };
  }>;
}

const DRIVER_NAME = "scai-brand-review";
const DRIVER_INFO_URI = "https://github.com/sitecore-studio-labs/sitecoreai-cli";
const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

const sectionRuleId = (section: BrandReviewSectionResult): string => {
  const base = section.section.replace(/\s+/g, "-").toLowerCase();
  const field = section.field ? `/${section.field.replace(/\s+/g, "-").toLowerCase()}` : "";
  return `brand/${base}${field}`;
};

const sectionMessage = (section: BrandReviewSectionResult, label: string): string => {
  const base = `[${label}] ${section.section}${section.field ? ` / ${section.field}` : ""}: score ${section.score}/5`;
  const explanation = section.explanation ? ` — ${section.explanation}` : "";
  const suggestions =
    section.suggestions && section.suggestions.length > 0
      ? `\nSuggestions:\n  - ${section.suggestions.join("\n  - ")}`
      : "";
  return `${base}${explanation}${suggestions}`;
};

const shouldEmit = (score: BrandReviewScore, threshold: BrandReviewScore | undefined): boolean => {
  if (threshold !== undefined) {
    return score < threshold;
  }
  return score <= 3;
};

export const buildSarifReport = (
  outcomes: readonly ReviewOutcome[],
  threshold: BrandReviewScore | undefined,
  driverVersion: string
): SarifReport => {
  const results: SarifResult[] = [];
  const ruleMap = new Map<string, SarifRule>();

  const addRule = (id: string, shortText: string): void => {
    if (!ruleMap.has(id)) {
      ruleMap.set(id, { id, shortDescription: { text: shortText } });
    }
  };

  for (const outcome of outcomes) {
    if (outcome.kind === "error") {
      addRule("brand/api-error", "Brand Review API call failed for this file");
      results.push({
        ruleId: "brand/api-error",
        level: "error",
        message: { text: outcome.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: outcome.label } } }],
      });
      continue;
    }
    for (const section of outcome.result.sectionResults) {
      if (!shouldEmit(section.score, threshold)) continue;
      const ruleId = sectionRuleId(section);
      addRule(
        ruleId,
        `Brand compliance: ${section.section}${section.field ? ` / ${section.field}` : ""}`
      );
      results.push({
        ruleId,
        level: scoreToSarifLevel(section.score),
        message: { text: sectionMessage(section, outcome.label) },
        locations: [{ physicalLocation: { artifactLocation: { uri: outcome.label } } }],
      });
    }
  }

  return {
    version: "2.1.0",
    $schema: SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: DRIVER_NAME,
            version: driverVersion,
            informationUri: DRIVER_INFO_URI,
            rules: Array.from(ruleMap.values()),
          },
        },
        results,
      },
    ],
  };
};
