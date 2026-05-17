/**
 * Publishing domain MCP tools — read-side + cancel only.
 *
 * Deliberately MINIMAL surface for the v1 ship:
 *
 *   - `publish_inspect` (read): `status` / `list-running` / `history`.
 *     No mutating fall-through; no scope-token mint (the operator
 *     mints scope tokens through the CLI dry-run flow, then passes
 *     them out-of-band — the agent never holds one).
 *
 *   - `publish_lifecycle` (write): `cancel` only. Cancel is the
 *     safety-improving op (stops a running publish); recoverable by
 *     resubmission.
 *
 * NOT exposed via MCP — by design:
 *
 *   - `submit_item` / `submit_all`: publishing pushes content to
 *     Experience Edge and is immediately visible to end users. The
 *     safety model (`feedback_destructive_ops_need_consent`) requires
 *     structured consent that only a human-driven CLI invocation
 *     mints. An MCP-callable submit would let an agent both prepare
 *     and execute, defeating the consent gate. Submission stays
 *     CLI-only until a proper MCP consent flow is designed.
 *
 *   - `unpublish`: same rationale. Even the reversible
 *     `never-publish` strategy modifies content state and triggers an
 *     Edge update; gated to CLI for now.
 */

import { z } from "zod";
import { resolveEnvironment } from "@/shared/env";
import { ensureMcpElevationAllowed } from "@/shared/allow-write";
import { createScaiError } from "@/shared/errors";
import { acquirePublishingToken } from "@/publishing/api/auth";
import { cancelPublishJob, getPublishJob, listPublishJobs } from "@/publishing/api/client";
import { readRecentPublishAudit } from "@/publishing/audit";
import type { PublishingApiClientOptions } from "@/publishing/api/types";
import { resolveToolBinding } from "../auth";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, environmentBindingShape, paginationShape } from "../schemas/common";

const acquireClient = async (envName: string): Promise<PublishingApiClientOptions> => {
  const { environment, timeoutMs } = resolveEnvironment({ environmentName: envName });
  const accessToken = await acquirePublishingToken({ envName, environment });
  return { accessToken, timeoutMs };
};

export const registerPublishingTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "publish_inspect",
    description: TOOL_DESCRIPTIONS.publish_inspect,
    auth: "read",
    annotations: {
      title: "Inspect publishing jobs and history",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["status", "list-running", "history"])
        .describe(
          "Which read operation: `status` (one job, jobId required), `list-running` (all queued/running in env), `history` (local audit log)."
        ),
      jobId: z.string().optional().describe("Publish job id. Required for verb='status'."),
      historyEnv: z
        .string()
        .optional()
        .describe("verb='history': filter to entries from this env name."),
      historyCommand: z
        .string()
        .optional()
        .describe("verb='history': substring match against the audit `command` field."),
      historyOutcome: z
        .enum(["ok", "error", "cancelled"])
        .optional()
        .describe("verb='history': filter by outcome."),
      ...paginationShape,
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const envName = input.environmentName ?? context.envName;
      switch (input.verb) {
        case "status": {
          if (!input.jobId) {
            throw createScaiError("verb='status' requires a `jobId`.", "INPUT_INVALID");
          }
          const client = await acquireClient(envName);
          const job = await getPublishJob(client, input.jobId);
          return {
            content: [{ type: "text", text: `Job ${job.id}: ${job.state}` }],
            structuredContent: { verb: "status", job },
          };
        }
        case "list-running": {
          const client = await acquireClient(envName);
          const jobs = await listPublishJobs(client, { statuses: ["Queued", "Running"] });
          return {
            content: [
              {
                type: "text",
                text: `${jobs.length} job(s) queued or running in env '${envName}'.`,
              },
            ],
            structuredContent: { verb: "list-running", jobs, count: jobs.length },
          };
        }
        case "history": {
          const all = readRecentPublishAudit(500);
          const filtered = all.filter((entry) => {
            if (input.historyEnv && entry.scope?.envName !== input.historyEnv) {
              return false;
            }
            if (input.historyCommand && !entry.command.includes(input.historyCommand)) {
              return false;
            }
            if (input.historyOutcome && entry.outcome !== input.historyOutcome) {
              return false;
            }
            return true;
          });
          const limit = input.limit;
          const trimmed = filtered.slice(-limit);
          return {
            content: [
              {
                type: "text",
                text: `Returned ${trimmed.length} audit entr${trimmed.length === 1 ? "y" : "ies"}.`,
              },
            ],
            structuredContent: {
              verb: "history",
              entries: trimmed,
              count: trimmed.length,
              scanned: all.length,
            },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "publish_lifecycle",
    description: TOOL_DESCRIPTIONS.publish_lifecycle,
    auth: "write",
    annotations: {
      title: "Cancel a running publish job",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["cancel"])
        .describe("Which mutation. Only `cancel` is exposed via MCP; submission is CLI-only."),
      jobId: z.string().describe("Publish job id to cancel."),
      ...environmentBindingShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const binding = await resolveToolBinding(context, input.environmentName);
      ensureMcpElevationAllowed(binding.resolved.root, binding.envName);
      const client = await acquireClient(binding.envName);
      await cancelPublishJob(client, input.jobId);
      // Re-read to capture the post-cancel state (cancellation is
      // asynchronous server-side; the immediate state is typically
      // `cancelling` not `cancelled`).
      const job = await getPublishJob(client, input.jobId);
      return {
        content: [{ type: "text", text: `Cancel requested for ${job.id} (now ${job.state}).` }],
        structuredContent: { verb: "cancel", job },
      };
    },
  });
};
