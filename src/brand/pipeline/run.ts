import { requestBrandApi, type BrandApiClientOptions } from "../api/client";
import type { components as PipelineComponents } from "../api/schema.pipeline";

/** Base path for the Brand Pipeline API. */
export const PIPELINE_BASE_PATH = "/stream/ai-pipeline-api";

type CreatePipelineRunResponse = PipelineComponents["schemas"]["CreatePipelineRunResponse"];

export interface RunBrandIngestionOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  /**
   * Whether the pipeline should populate the brand kit's sections with
   * the ingested content. Defaults to `true` — without it, sections
   * stay empty and `scai brand review` will keep crashing with the
   * 500 'name' bug ([[project-scai-brand-review-empty-kit-500]]).
   */
  populateSections?: boolean;
  /**
   * Restrict ingestion to specific document IDs. The API wants this as
   * a single comma-separated string. When omitted, every unprocessed
   * document attached to the kit gets ingested.
   */
  documentIds?: string[];
  signal?: AbortSignal;
}

export interface RunEnrichSectionsOptions {
  client: BrandApiClientOptions;
  brandKitId: string;
  /** Restrict enrichment to specific section UUIDs. */
  sectionIds?: string[];
  /** Restrict enrichment to specific field UUIDs within those sections. */
  fieldIds?: string[];
  signal?: AbortSignal;
}

const buildOrgScopedPath = (orgId: string, pipelineName: string): string =>
  `/api/data/v1/organizations/${orgId}/pipeline/${pipelineName}`;

/**
 * Trigger the brand ingestion pipeline against a brand kit.
 *
 * The pipeline processes brand documents (uploaded via the Documents
 * API) and chunks them into knowledge pieces that drive brand-review
 * compliance scoring. When `populateSections: true` (the default),
 * the resulting brand knowledge also populates the kit's sections and
 * fields.
 *
 * The endpoint is fire-and-forget: it returns a run id + timestamps
 * but no completion status. There is no documented GET endpoint for
 * pipeline run status as of 2026-05-14 — callers waiting for
 * completion should poll the brand kit's sections list and watch for
 * section count to go from 0 to > 0.
 */
export const runBrandIngestionPipeline = async (
  options: RunBrandIngestionOptions
): Promise<CreatePipelineRunResponse> => {
  const documentIds = options.documentIds?.length ? options.documentIds.join(",") : undefined;
  return requestBrandApi<CreatePipelineRunResponse>(options.client, {
    basePath: PIPELINE_BASE_PATH,
    path: buildOrgScopedPath(options.client.orgId, "BrandIngestionPipeline"),
    method: "POST",
    body: {
      parameters: {
        brand_kit_id: options.brandKitId,
        populateSections: options.populateSections ?? true,
        documentIdsList: documentIds,
      },
    },
    signal: options.signal,
  });
};

/**
 * Trigger the enrichment pipeline for an already-ingested brand kit.
 * Useful after the operator manually edits a brand kit field and
 * wants the AI to re-derive related sections.
 *
 * Same fire-and-forget shape as brand ingestion — no run-status GET
 * endpoint exists; poll the section/field contents to detect changes.
 */
export const runEnrichSectionsPipeline = async (
  options: RunEnrichSectionsOptions
): Promise<CreatePipelineRunResponse> => {
  return requestBrandApi<CreatePipelineRunResponse>(options.client, {
    basePath: PIPELINE_BASE_PATH,
    path: buildOrgScopedPath(options.client.orgId, "EnrichSectionsPipeline"),
    method: "POST",
    body: {
      parameters: {
        brand_kit_id: options.brandKitId,
        sectionIdsList: options.sectionIds?.length ? options.sectionIds.join(",") : undefined,
        fieldIdsList: options.fieldIds?.length ? options.fieldIds.join(",") : undefined,
      },
    },
    signal: options.signal,
  });
};
