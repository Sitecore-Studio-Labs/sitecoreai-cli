/**
 * Brand domain — inspect, manage, review.
 *
 * Three workflow-shaped tools cover the entire AI Skills brand surface:
 *
 *   - `brand_inspect` — discriminated `{ verb }` read tool. Lists kits,
 *     gets one kit, lists sections (with names), lists subsections
 *     (fields) within a section, lists documents in the org, gets a
 *     single document. The single tool replaces eight CLI verbs so
 *     agents don't have to memorize a half-dozen entry points.
 *
 *   - `brand_manage` — discriminated `{ action }` write tool. Covers
 *     create/publish/delete kit, upload/delete doc, ingest + enrich
 *     pipelines, and the `seed` composite that runs the full 7-step
 *     recipe end-to-end. Gated `auth: "write"` so the dispatch layer's
 *     allowWrite check fires before any side effect.
 *
 *   - `brand_review` — single-purpose tool wrapping `generateBrandReview`.
 *     This is the headline agent-loop op ("evaluate copy against a
 *     brand kit"); kept separate from inspect/manage because it has
 *     real cost-per-call semantics and shows up at the top of every
 *     CI gate.
 *
 * Every handler delegates to the same library primitives the CLI uses;
 * this MCP layer only forwards routing + structured-content envelopes.
 */

import { z } from "zod";
import { readRootConfiguration } from "@/config/root-config";
import {
  createBrandKit,
  deleteBrandKit,
  deleteDocument,
  generateBrandReview,
  getBrandKit,
  getDocument,
  listBrandKitFields,
  listBrandKitSections,
  listBrandKits,
  listDocuments,
  publishBrandKit,
  runBrandIngestionPipeline,
  runEnrichSectionsPipeline,
  seedBrandKit,
  updateBrandKitField,
  uploadDocument,
  LOCAL_UPLOAD_UNSUPPORTED_MESSAGE,
  LOCAL_UPLOAD_UNSUPPORTED_HINT,
  type BrandApiClientOptions,
  type BrandKitFieldValue,
  type SeedProgressEvent,
} from "@/brand";
import { createScaiError } from "@/shared/errors";
import type { McpContext } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape } from "../schemas/common";

/**
 * Resolve the AI Skills client for an environment. Org is DERIVED from
 * the target env's `organizationId` — there is no separate `orgId`
 * input ("derive org" decision of the multi-env redesign). When
 * `environmentName` is omitted the bound env is used.
 */
const resolveBrandClient = (
  context: McpContext,
  environmentName?: string
): BrandApiClientOptions => {
  const envName = environmentName ?? context.envName;
  const root = readRootConfiguration(context.configPath, envName);
  const env = root.environments[envName];
  const orgId = env?.organizationId;
  if (!orgId) {
    throw createScaiError(`Env '${envName}' has no organizationId.`, "INPUT_INVALID", {
      hint: "Set organizationId on the env profile in sitecoreai.cli.json.",
    });
  }
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    throw createScaiError(
      `No AI Skills credential is configured for org '${orgId}'.`,
      "AUTH_AI_SKILLS_REQUIRED",
      { hint: `Run \`scai setup login ai-skills -n ${envName}\` to provision one.` }
    );
  }
  return { orgId, credential };
};

export const registerBrandTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "brand_inspect",
    description: TOOL_DESCRIPTIONS.brand_inspect,
    auth: "read",
    annotations: {
      title: "Inspect Sitecore brand kits — list, get sections, get fields",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["list-kits", "get-kit", "list-sections", "list-fields", "list-docs", "get-doc"])
        .describe(
          "Which read op to run. list-kits: org-wide kit list. get-kit: single kit by id. list-sections: section names + IDs for a kit (only populated after enrichment). list-fields: subsections within a section, with the AI intent + populated value. list-docs: documents in the org, optionally filtered. get-doc: single doc by id (useful for polling pipeline status)."
        ),
      brandKitId: z
        .string()
        .optional()
        .describe(
          "Brand kit UUID. Required for get-kit, list-sections, list-fields. Optional filter for list-docs."
        ),
      sectionId: z.string().optional().describe("Section UUID — required for list-fields."),
      documentId: z.string().optional().describe("Document UUID — required for get-doc."),
      status: z
        .enum(["pending", "processed", "draft", "active", "archived", "edited", "failed"])
        .optional()
        .describe("Filter docs by status. Useful for finding failed uploads."),
      pageNumber: z.number().int().positive().optional().describe("1-based page number."),
      pageSize: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Items per page (max 100)."),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const client = resolveBrandClient(context, input.environmentName);
      switch (input.verb) {
        case "list-kits": {
          const response = await listBrandKits({
            client,
            pageNumber: input.pageNumber,
            pageSize: input.pageSize,
          });
          return {
            content: [{ type: "text", text: `${response.totalCount} kit(s).` }],
            structuredContent: { verb: input.verb, ...response },
          };
        }
        case "get-kit": {
          if (!input.brandKitId) {
            throw createScaiError("verb='get-kit' requires `brandKitId`.", "INPUT_INVALID");
          }
          const kit = await getBrandKit({ client, brandKitId: input.brandKitId });
          return {
            content: [{ type: "text", text: `${kit.name} (${kit.status ?? "?"})` }],
            structuredContent: { verb: input.verb, kit },
          };
        }
        case "list-sections": {
          if (!input.brandKitId) {
            throw createScaiError("verb='list-sections' requires `brandKitId`.", "INPUT_INVALID");
          }
          const sections = await listBrandKitSections({ client, brandKitId: input.brandKitId });
          return {
            content: [{ type: "text", text: `${sections.length} section(s).` }],
            structuredContent: {
              verb: input.verb,
              brandKitId: input.brandKitId,
              count: sections.length,
              sections,
            },
          };
        }
        case "list-fields": {
          if (!input.brandKitId || !input.sectionId) {
            throw createScaiError(
              "verb='list-fields' requires `brandKitId` and `sectionId`.",
              "INPUT_INVALID"
            );
          }
          const fields = await listBrandKitFields({
            client,
            brandKitId: input.brandKitId,
            sectionId: input.sectionId,
          });
          return {
            content: [{ type: "text", text: `${fields.length} field(s).` }],
            structuredContent: {
              verb: input.verb,
              brandKitId: input.brandKitId,
              sectionId: input.sectionId,
              count: fields.length,
              fields,
            },
          };
        }
        case "list-docs": {
          const response = await listDocuments({
            client,
            brandKitId: input.brandKitId,
            status: input.status,
            pageNumber: input.pageNumber,
            pageSize: input.pageSize,
          });
          return {
            content: [{ type: "text", text: `${response.totalCount} doc(s).` }],
            structuredContent: { verb: input.verb, ...response },
          };
        }
        case "get-doc": {
          if (!input.documentId) {
            throw createScaiError("verb='get-doc' requires `documentId`.", "INPUT_INVALID");
          }
          const doc = await getDocument({ client, documentId: input.documentId });
          return {
            content: [
              {
                type: "text",
                text: `${doc.title ?? "(untitled)"} — status=${doc.status ?? "?"} chunked=${doc.chunked ?? "null"} summarized=${doc.summarized ?? "null"}`,
              },
            ],
            structuredContent: { verb: input.verb, document: doc },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "brand_manage",
    description: TOOL_DESCRIPTIONS.brand_manage,
    auth: "write",
    annotations: {
      title: "Manage Sitecore brand kits — create, publish, delete, ingest, enrich, seed",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      action: z
        .enum([
          "create-kit",
          "publish-kit",
          "delete-kit",
          "upload-doc",
          "delete-doc",
          "run-ingestion",
          "run-enrichment",
          "seed",
          "update-field",
        ])
        .describe(
          "Write action. create-kit: new kit in draft. publish-kit: PATCH status to published (required before pipelines populate sections). delete-kit: irreversible kit removal. upload-doc: attach a PDF to a kit by URL (local-file upload is not supported). delete-doc: irreversible doc removal. run-ingestion: BrandIngestionPipeline (chunks docs). run-enrichment: EnrichSectionsPipeline (populates sections). seed: full 7-step recipe — create + upload + publish + ingest + enrich + poll; takes 5–15 min wall-clock. update-field: direct PATCH of a single field's value, bypassing the AI pipeline — the reliable population path for AI-generated kits whose synthesized PDF didn't survive Sitecore's parser (see scai://help/brand-kit-generation)."
        ),
      // create-kit + seed
      name: z.string().optional().describe("Kit name (create-kit, seed)."),
      description: z.string().optional().describe("Kit description (create-kit, seed)."),
      industry: z.string().optional().describe("Industry label (create-kit, seed)."),
      brandName: z.string().optional().describe("Internal brand name (create-kit)."),
      // publish-kit, delete-kit, upload-doc, run-ingestion, run-enrichment
      brandKitId: z
        .string()
        .optional()
        .describe("Brand kit UUID. Required for everything except create-kit + delete-doc + seed."),
      // upload-doc + seed
      url: z
        .string()
        .optional()
        .describe(
          "Public HTTPS URL to a PDF that Sitecore's edge can fetch. Required for upload-doc and seed."
        ),
      bytesBase64: z
        .string()
        .optional()
        .describe(
          "(Unsupported) base64 file bytes. Local-file upload has no working path on the documents API — pass a hosted `url` instead. Rejected with INPUT_INVALID."
        ),
      mimeType: z
        .string()
        .optional()
        .describe(
          "Document MIME type for the `fileType` field (upload-doc). Defaults to application/pdf."
        ),
      title: z.string().optional().describe("Document title (upload-doc)."),
      summary: z.string().optional().describe("Document summary (upload-doc)."),
      // delete-doc
      documentId: z.string().optional().describe("Document UUID. Required for delete-doc."),
      // run-ingestion
      documentIds: z
        .array(z.string())
        .optional()
        .describe("Document UUIDs for ingestion. Empty = all unprocessed docs in the kit."),
      populateSections: z
        .boolean()
        .optional()
        .describe("Whether ingestion should populate sections (run-ingestion). Default true."),
      // run-enrichment
      sectionIds: z
        .array(z.string())
        .optional()
        .describe("Section UUIDs to scope enrichment to (run-enrichment)."),
      fieldIds: z
        .array(z.string())
        .optional()
        .describe("Field UUIDs to scope enrichment to (run-enrichment)."),
      // seed
      timeoutSec: z
        .number()
        .int()
        .positive()
        .max(1800)
        .optional()
        .describe(
          "Hard timeout in seconds when waiting on sections to populate (seed). Default 900 = 15 min."
        ),
      // update-field
      sectionId: z.string().optional().describe("Section UUID. Required for update-field."),
      fieldId: z
        .string()
        .optional()
        .describe("Field (subsection) UUID. Required for update-field."),
      value: z
        .union([
          z.string(),
          z.array(
            z.object({
              name: z.string(),
              id: z.string().optional(),
              tags: z.array(z.string()).optional(),
              restrictions: z.string().optional(),
            })
          ),
        ])
        .optional()
        .describe(
          "Field value for update-field. Shape MUST match the field's `type`: string for `text` fields, [{name}] for `array`, [{name, tags?, restrictions?}] for `richArray`. Look up the type with brand_inspect verb='list-fields' first."
        ),
      intent: z.string().optional().describe("Update the AI-facing intent string (update-field)."),
      verified: z
        .boolean()
        .optional()
        .describe(
          "Mark the field as operator-verified (update-field). Operator-curated kits typically set this true once values are reviewed."
        ),
      aiEditable: z
        .boolean()
        .optional()
        .describe(
          "Whether the enrichment pipeline may overwrite this field (update-field). Set false to lock manually-curated values against pipeline reruns."
        ),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context, extra) => {
      const client = resolveBrandClient(context, input.environmentName);
      switch (input.action) {
        case "create-kit": {
          if (!input.name) {
            throw createScaiError("action='create-kit' requires `name`.", "INPUT_INVALID");
          }
          const kit = await createBrandKit({
            client,
            name: input.name,
            description: input.description,
            industry: input.industry,
            brandName: input.brandName,
          });
          return {
            content: [{ type: "text", text: `Created kit ${kit.id} (status: ${kit.status}).` }],
            structuredContent: { action: input.action, kit },
          };
        }
        case "publish-kit": {
          if (!input.brandKitId) {
            throw createScaiError("action='publish-kit' requires `brandKitId`.", "INPUT_INVALID");
          }
          const kit = await publishBrandKit({ client, brandKitId: input.brandKitId });
          return {
            content: [{ type: "text", text: `Kit ${kit.id} status: ${kit.status}.` }],
            structuredContent: { action: input.action, kit },
          };
        }
        case "delete-kit": {
          if (!input.brandKitId) {
            throw createScaiError("action='delete-kit' requires `brandKitId`.", "INPUT_INVALID");
          }
          await deleteBrandKit({ client, brandKitId: input.brandKitId });
          return {
            content: [{ type: "text", text: `Deleted kit ${input.brandKitId}.` }],
            structuredContent: {
              action: input.action,
              brandKitId: input.brandKitId,
              deleted: true,
            },
          };
        }
        case "upload-doc": {
          if (!input.brandKitId) {
            throw createScaiError("action='upload-doc' requires `brandKitId`.", "INPUT_INVALID");
          }
          if (input.bytesBase64) {
            throw createScaiError(LOCAL_UPLOAD_UNSUPPORTED_MESSAGE, "INPUT_INVALID", {
              hint: LOCAL_UPLOAD_UNSUPPORTED_HINT,
            });
          }
          if (!input.url) {
            throw createScaiError("action='upload-doc' requires `url`.", "INPUT_INVALID", {
              hint: LOCAL_UPLOAD_UNSUPPORTED_HINT,
            });
          }
          const doc = await uploadDocument({
            client,
            brandKitId: input.brandKitId,
            source: { url: input.url },
            title: input.title,
            summary: input.summary,
            fileType: input.mimeType ?? "application/pdf",
          });
          return {
            content: [{ type: "text", text: `Uploaded ${doc.id} (status: ${doc.status}).` }],
            structuredContent: { action: input.action, document: doc },
          };
        }
        case "delete-doc": {
          if (!input.documentId) {
            throw createScaiError("action='delete-doc' requires `documentId`.", "INPUT_INVALID");
          }
          await deleteDocument({ client, documentId: input.documentId });
          return {
            content: [{ type: "text", text: `Deleted document ${input.documentId}.` }],
            structuredContent: {
              action: input.action,
              documentId: input.documentId,
              deleted: true,
            },
          };
        }
        case "run-ingestion": {
          if (!input.brandKitId) {
            throw createScaiError("action='run-ingestion' requires `brandKitId`.", "INPUT_INVALID");
          }
          const run = await runBrandIngestionPipeline({
            client,
            brandKitId: input.brandKitId,
            populateSections: input.populateSections,
            documentIds: input.documentIds,
          });
          return {
            content: [
              {
                type: "text",
                text: `Started BrandIngestionPipeline run ${run.id}. Follow up with run-enrichment to populate sections.`,
              },
            ],
            structuredContent: { action: input.action, run },
          };
        }
        case "run-enrichment": {
          if (!input.brandKitId) {
            throw createScaiError(
              "action='run-enrichment' requires `brandKitId`.",
              "INPUT_INVALID"
            );
          }
          const run = await runEnrichSectionsPipeline({
            client,
            brandKitId: input.brandKitId,
            sectionIds: input.sectionIds,
            fieldIds: input.fieldIds,
          });
          return {
            content: [{ type: "text", text: `Started EnrichSectionsPipeline run ${run.id}.` }],
            structuredContent: { action: input.action, run },
          };
        }
        case "update-field": {
          if (!input.brandKitId || !input.sectionId || !input.fieldId) {
            throw createScaiError(
              "action='update-field' requires `brandKitId`, `sectionId`, and `fieldId`.",
              "INPUT_INVALID"
            );
          }
          if (
            input.value === undefined &&
            input.intent === undefined &&
            input.verified === undefined &&
            input.aiEditable === undefined
          ) {
            throw createScaiError(
              "action='update-field' requires at least one of `value`, `intent`, `verified`, or `aiEditable`.",
              "INPUT_INVALID"
            );
          }
          const field = await updateBrandKitField({
            client,
            brandKitId: input.brandKitId,
            sectionId: input.sectionId,
            fieldId: input.fieldId,
            value: input.value as BrandKitFieldValue | undefined,
            intent: input.intent,
            verified: input.verified,
            aiEditable: input.aiEditable,
          });
          return {
            content: [
              {
                type: "text",
                text: `Updated field ${field.name} (${field.id}). verified=${field.verified === true ? "true" : "false"}.`,
              },
            ],
            structuredContent: { action: input.action, field },
          };
        }
        case "seed": {
          if (!input.name) {
            throw createScaiError("action='seed' requires `name`.", "INPUT_INVALID");
          }
          if (input.bytesBase64) {
            throw createScaiError(LOCAL_UPLOAD_UNSUPPORTED_MESSAGE, "INPUT_INVALID", {
              hint: LOCAL_UPLOAD_UNSUPPORTED_HINT,
            });
          }
          if (!input.url) {
            throw createScaiError("action='seed' requires `url`.", "INPUT_INVALID", {
              hint: LOCAL_UPLOAD_UNSUPPORTED_HINT,
            });
          }
          const source = { url: input.url };
          // Forward progress to the client via MCP progress notifications.
          // The seed composite emits ~10 events; mapping `pollSections`
          // ticks to progress numerator lets the client render a bar.
          let progressN = 0;
          const onProgress = async (event: SeedProgressEvent): Promise<void> => {
            progressN += 1;
            await extra.sendProgress(progressN, undefined, `${event.stage}: ${event.message}`);
          };
          const result = await seedBrandKit({
            client,
            name: input.name,
            source,
            description: input.description,
            industry: input.industry,
            timeoutSec: input.timeoutSec,
            onProgress: (event) => {
              void onProgress(event);
            },
            signal: extra.signal,
          });
          return {
            content: [
              {
                type: "text",
                text: `Seeded kit ${result.kit.id} with ${result.sections.length} section(s) in ${result.elapsedSec}s.`,
              },
            ],
            structuredContent: { action: input.action, ...result },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "brand_review",
    description: TOOL_DESCRIPTIONS.brand_review,
    auth: "read",
    annotations: {
      title: "Generate a Brand Review — score content against a brand kit",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      brandKitId: z
        .string()
        .describe("Brand kit UUID to evaluate against. The kit must have populated sections."),
      text: z.string().describe("Content to evaluate (text, markdown, JSON — server is flexible)."),
      label: z
        .string()
        .optional()
        .describe(
          "Caller-supplied label for the input (e.g. file path). Surfaces in output for aggregation."
        ),
      sectionIds: z
        .array(z.string())
        .optional()
        .describe("Restrict evaluation to these section UUIDs. Empty = all sections."),
      fieldIds: z
        .array(z.string())
        .optional()
        .describe(
          "Restrict evaluation to specific field UUIDs. When set, applies within the listed sections."
        ),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const client = resolveBrandClient(context, input.environmentName);
      const sections = input.sectionIds?.length
        ? input.sectionIds.map((sectionId) => ({
            sectionId,
            fieldIds: input.fieldIds?.length ? input.fieldIds : undefined,
          }))
        : undefined;
      const result = await generateBrandReview({
        client,
        input: { text: input.text, label: input.label },
        selector: {
          brandKitId: input.brandKitId,
          sections,
        },
      });
      return {
        content: [
          {
            type: "text",
            text: `Brand review: overall ${result.overallScore}/5 across ${result.sectionResults.length} section result(s).`,
          },
        ],
        structuredContent: {
          brandKitId: input.brandKitId,
          overallScore: result.overallScore,
          sectionResultCount: result.sectionResults.length,
          sectionResults: result.sectionResults,
        },
      };
    },
  });
};
