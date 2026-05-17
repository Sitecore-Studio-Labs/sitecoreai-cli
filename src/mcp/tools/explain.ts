/**
 * Explain MCP tool — the projection of `scai hygiene explain`.
 *
 * `audit_inspect` runs ONE audit at a time. `explain` is the composed
 * surface: a single `{ verb }`-discriminated entry that chains several
 * audits into a focused answer to a specific operator question —
 *
 *   - `why-blocked`  — every inbound reference that would block a delete
 *                      of an item (`audit references` +
 *                      `audit template-dependencies`), sorted by kind.
 *   - `orphan-site`  — what residue a deleted site left behind, and
 *                      which of it is still referenced by live content
 *                      (`audit site-residue` + `audit references`).
 *
 * Read-only: the composed audits never mutate the tenant. The runners
 * are the exact CLI-shared `runExplain*` tasks invoked with
 * `silent: true` so nothing reaches stdout — the MCP layer owns the
 * structured envelope; the task only returns its report.
 */
import { z } from "zod";
import { runExplainWhyBlocked } from "@/hygiene/tasks/explain/why-blocked";
import { runExplainOrphanSite } from "@/hygiene/tasks/explain/orphan-site";
import { createScaiError } from "@/shared/errors";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { environmentBindingShape } from "../schemas/common";

export const registerExplainTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "explain",
    description: TOOL_DESCRIPTIONS.explain,
    auth: "read",
    annotations: {
      title: "Compose audits into a focused operator answer",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["why-blocked", "orphan-site"])
        .describe(
          "Which composed question to answer. `why-blocked` lists every inbound reference blocking a delete of `itemId`. `orphan-site` lists the residue a deleted `site` left behind and flags trees still referenced by live content."
        ),
      itemId: z
        .string()
        .optional()
        .describe(
          "verb='why-blocked': the item to explain (any GUID form). Required for that verb."
        ),
      site: z
        .string()
        .optional()
        .describe(
          "verb='orphan-site': the deleted site (or tenant) folder name to explain. Required for that verb."
        ),
      root: z
        .string()
        .optional()
        .describe(
          "verb='why-blocked': content root for the field-value scan. Default `/sitecore/content`."
        ),
      index: z.string().optional().describe("Override the search index name used by the scan."),
      limit: z
        .number()
        .int()
        .positive()
        .max(50_000)
        .optional()
        .describe("Cap on inbound references counted per scan."),
      skipContentScan: z
        .boolean()
        .optional()
        .describe(
          "verb='why-blocked': skip the slow field-value content scan. Use when only structural template refs matter."
        ),
      skipTemplateDeps: z
        .boolean()
        .optional()
        .describe(
          "verb='why-blocked': skip the search-index template-dependency check. Use for leaf content items never referenced as a template."
        ),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      const base = {
        config: context.configPath,
        environmentName: envName,
        quiet: true,
        json: true,
        silent: true,
      };

      if (input.verb === "why-blocked") {
        if (!input.itemId) {
          throw createScaiError("verb='why-blocked' requires `itemId`.", "INPUT_INVALID");
        }
        const report = await runExplainWhyBlocked({
          ...base,
          itemId: input.itemId,
          ...(input.root !== undefined && { root: input.root }),
          ...(input.index !== undefined && { index: input.index }),
          ...(input.limit !== undefined && { limit: input.limit }),
          ...(input.skipContentScan !== undefined && { skipContentScan: input.skipContentScan }),
          ...(input.skipTemplateDeps !== undefined && { skipTemplateDeps: input.skipTemplateDeps }),
        });
        return {
          content: [
            {
              type: "text",
              text:
                report.blockers.length === 0
                  ? `${report.itemId} has no inbound references — safe to delete.`
                  : `${report.itemId} is blocked by ${report.blockers.length} inbound reference(s).`,
            },
          ],
          structuredContent: { verb: input.verb, ...report },
        };
      }

      if (!input.site) {
        throw createScaiError("verb='orphan-site' requires `site`.", "INPUT_INVALID");
      }
      const report = await runExplainOrphanSite({
        ...base,
        site: input.site,
        ...(input.index !== undefined && { index: input.index }),
        ...(input.limit !== undefined && { limit: input.limit }),
      });
      const referenced = report.orphans.filter((o) => o.inboundRefs > 0).length;
      return {
        content: [
          {
            type: "text",
            text:
              report.orphans.length === 0
                ? `No orphan residue found for site '${report.site}'.`
                : `Site '${report.site}': ${report.orphans.length} orphan tree(s), ${referenced} still referenced.`,
          },
        ],
        structuredContent: { verb: input.verb, ...report },
      };
    },
  });
};
