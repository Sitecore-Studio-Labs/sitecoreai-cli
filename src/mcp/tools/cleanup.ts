/**
 * Cleanup domain — preview + execute.
 *
 * Two tools cover the destructive hygiene surface:
 *
 *   - `cleanup_preview` (read) — runs any cleanup verb with
 *     `whatIf: true` so the agent can show the user what would change
 *     before asking for write authorization. No tenant mutations occur.
 *
 *   - `cleanup_execute` (write) — single destructive entry point,
 *     discriminated on `verb`. Honors the per-call `allowWrite` gate
 *     enforced at dispatch, the `whatIf` plan-only flag, and per-verb
 *     blast-radius caps (`max*` options forwarded to the underlying
 *     library). Every verb returns a per-action list so the caller can
 *     inspect what actually applied.
 *
 * Verb routing is intentionally narrow: only verbs whose underlying
 * library has a real `--what-if` path are exposed. Anything else lives
 * behind the CLI today and stays there until its semantics are
 * MCP-shaped (e.g. interactive-keep duplicates).
 */

import { z } from "zod";
import {
  runCleanupArchivePurge,
  runCleanupDeadTemplates,
  runCleanupDuplicates,
  runCleanupEmptyFolders,
  runCleanupFindReplace,
  runCleanupRoles,
  runCleanupUsers,
  runCleanupVersionsArchive,
  runCleanupVersionsPrune,
} from "@/hygiene/tasks";
import { createScaiError } from "@/shared/errors";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, whatIfShape } from "../schemas/common";

/**
 * Cleanup verb registry — verb name → task runner. Each runner accepts
 * an option bag whose shape varies per verb; the input schema below
 * documents which options each verb honors.
 */
const CLEANUP_RUNNERS: Record<
  string,
  (options: Record<string, unknown>) => Promise<unknown[]>
> = {
  "versions-prune": runCleanupVersionsPrune as never,
  "versions-archive": runCleanupVersionsArchive as never,
  "archive-purge": runCleanupArchivePurge as never,
  "dead-templates": runCleanupDeadTemplates as never,
  duplicates: runCleanupDuplicates as never,
  "empty-folders": runCleanupEmptyFolders as never,
  "find-replace": runCleanupFindReplace as never,
  roles: runCleanupRoles as never,
  users: runCleanupUsers as never,
};

const baseTaskOptions = (
  config: string,
  envName: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  config,
  environmentName: envName,
  quiet: true,
  json: true,
  ...overrides,
});

/** Validate verb-specific required inputs that the runner would otherwise reject later. */
const validateVerbInputs = (verb: string, input: Record<string, unknown>): void => {
  switch (verb) {
    case "versions-prune":
    case "versions-archive":
      if (input.keep === undefined) {
        throw createScaiError(`verb='${verb}' requires \`keep\`.`, "INPUT_INVALID");
      }
      if (!input.root) {
        throw createScaiError(`verb='${verb}' requires \`root\`.`, "INPUT_INVALID");
      }
      break;
    case "empty-folders":
      if (!input.root) {
        throw createScaiError("verb='empty-folders' requires `root`.", "INPUT_INVALID");
      }
      break;
    case "find-replace":
      if (!input.pattern || input.replacement === undefined) {
        throw createScaiError(
          "verb='find-replace' requires `pattern` and `replacement`.",
          "INPUT_INVALID"
        );
      }
      break;
  }
};

const summarizeActions = (verb: string, actions: unknown[]): string => {
  const counts = new Map<string, number>();
  for (const a of actions) {
    const status = (a as { status?: string }).status ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  if (counts.size === 0) return `cleanup ${verb}: 0 actions.`;
  const parts = [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
  return `cleanup ${verb}: ${actions.length} action(s) (${parts}).`;
};

/**
 * Forward every input field except routing/auth flags to the runner.
 * The library validates its own option keys; passing extras is safe
 * (each task reads only the keys it knows about).
 */
const buildRunnerOptions = (
  verb: string,
  input: Record<string, unknown>,
  shared: Record<string, unknown>,
  whatIf: boolean
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...shared, whatIf };
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === "verb" || k === "whatIf" || k === "allowWrite") continue;
    merged[k] = v;
  }
  // The `cleanup` verb name doesn't itself feed into runner options.
  void verb;
  return merged;
};

export const registerCleanupTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "cleanup_preview",
    description: TOOL_DESCRIPTIONS.cleanup_preview,
    auth: "read",
    annotations: {
      title: "Plan a cleanup verb without mutating the tenant",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: cleanupInputSchema(),
    handler: async (input, context) => {
      validateVerbInputs(input.verb, input as Record<string, unknown>);
      const runner = CLEANUP_RUNNERS[input.verb];
      if (!runner) {
        throw createScaiError(`Unknown cleanup verb '${input.verb}'.`, "INPUT_INVALID");
      }
      const opts = buildRunnerOptions(
        input.verb,
        input as Record<string, unknown>,
        baseTaskOptions(context.configPath, context.envName),
        true
      );
      const actions = await runner(opts);
      return {
        content: [{ type: "text", text: summarizeActions(input.verb, actions) }],
        structuredContent: {
          verb: input.verb,
          whatIf: true,
          count: actions.length,
          actions,
        },
      };
    },
  });

  registry.registerTool({
    name: "cleanup_execute",
    description: TOOL_DESCRIPTIONS.cleanup_execute,
    auth: "write",
    annotations: {
      title: "Execute a destructive cleanup verb (versions, archive, roles, users, ...)",
      readOnlyHint: false,
      // Every verb either deletes content/users/roles or rewrites field
      // values. Mark destructive so the host's confirmation UX fires.
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      ...cleanupInputSchema(),
      ...whatIfShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      validateVerbInputs(input.verb, input as Record<string, unknown>);
      const runner = CLEANUP_RUNNERS[input.verb];
      if (!runner) {
        throw createScaiError(`Unknown cleanup verb '${input.verb}'.`, "INPUT_INVALID");
      }
      const whatIf = input.whatIf === true;
      const opts = buildRunnerOptions(
        input.verb,
        input as Record<string, unknown>,
        baseTaskOptions(context.configPath, context.envName, {
          allowWrite: !whatIf,
        }),
        whatIf
      );
      const actions = await runner(opts);
      return {
        content: [{ type: "text", text: summarizeActions(input.verb, actions) }],
        structuredContent: {
          verb: input.verb,
          whatIf,
          count: actions.length,
          actions,
        },
      };
    },
  });
};

/**
 * Shared input schema for cleanup_preview + cleanup_execute. Built as a
 * function so each tool gets its own ZodRawShape instance (the registry
 * spreads them into separate input objects; sharing would couple the
 * defaults).
 */
const cleanupInputSchema = () =>
  ({
    verb: z
      .enum([
        "versions-prune",
        "versions-archive",
        "archive-purge",
        "dead-templates",
        "duplicates",
        "empty-folders",
        "find-replace",
        "roles",
        "users",
      ])
      .describe(
        "Which cleanup operation to run. Each verb maps 1:1 to a `scai cleanup …` CLI command and shares its option contract. Mostly destructive — pair with cleanup_preview first, or pass `whatIf: true`. Required fields per verb: versions-prune/versions-archive (`keep`, `root`); empty-folders (`root`); find-replace (`pattern`, `replacement`). All others have safe defaults but accept the same option bag."
      ),

    // versions-prune / versions-archive
    keep: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Number of most-recent versions to keep per (item, language). Required for versions-prune / versions-archive."
      ),
    root: z
      .string()
      .optional()
      .describe(
        "Content-tree root to operate under. Required for versions-prune, versions-archive, empty-folders. Default per-verb otherwise."
      ),
    language: z
      .string()
      .optional()
      .describe(
        "Restrict to a single language code (e.g. 'en'). Honored by versions-prune, versions-archive, find-replace."
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(50_000)
      .optional()
      .describe("Cap on items inspected. Per-verb default."),
    index: z.string().optional().describe("Override the search index name."),
    concurrency: z
      .number()
      .int()
      .positive()
      .max(32)
      .optional()
      .describe("Parallelism for the underlying library calls. Default 4."),
    includeSystem: z
      .boolean()
      .optional()
      .describe(
        "Permit operating against /sitecore/system + /sitecore/templates/System subtrees. Off by default."
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        "Override the per-verb safety guard that refuses to operate on platform subtrees (templates/System, layout/Layouts/System). Off by default."
      ),

    // archive-purge
    olderThanDays: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "archive-purge: only purge items archived more than N days ago. Default 30. Setting to 0 purges every archived item."
      ),
    archiveName: z
      .string()
      .optional()
      .describe("archive-purge: limit to one archive name."),
    pageSize: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("archive-purge: archive listing page size. Default 100."),

    // dead-templates
    cleanupEmptyFolders: z
      .boolean()
      .optional()
      .describe(
        "dead-templates: also delete now-empty template folders after removing dead templates. Default true."
      ),

    // duplicates
    minGroupSize: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("duplicates: minimum group size to consider a duplicate. Default 2."),
    keepRule: z
      .enum(["oldest", "newest", "shortest-path"])
      .optional()
      .describe(
        "duplicates: which group member survives. Default `oldest`. (interactive keep is CLI-only — not exposed via MCP.)"
      ),
    includeSystemFields: z
      .boolean()
      .optional()
      .describe("duplicates / find-replace: hash/scan __-prefixed system fields. Off by default."),

    // empty-folders
    maxDeletions: z
      .number()
      .int()
      .positive()
      .max(10_000)
      .optional()
      .describe(
        "Blast-radius cap. Default per-verb (empty-folders 500, roles 50, users 25)."
      ),

    // find-replace
    pattern: z
      .string()
      .optional()
      .describe("find-replace: search pattern. Required for find-replace."),
    replacement: z
      .string()
      .optional()
      .describe("find-replace: replacement string. Required for find-replace."),
    literal: z
      .boolean()
      .optional()
      .describe("find-replace: treat `pattern` as a literal string, not a regex. Default false."),
    ignoreCase: z
      .boolean()
      .optional()
      .describe("find-replace: case-insensitive matching. Default false."),
    flags: z
      .string()
      .optional()
      .describe("find-replace: regex flags string (e.g. 'gim'). Mutually exclusive with literal."),
    fields: z
      .array(z.string())
      .optional()
      .describe("find-replace: restrict to these field names."),
    batchSize: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("find-replace / duplicates: field-batch read size."),
    pageParallelism: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("find-replace: scan-page parallelism."),
    cache: z
      .boolean()
      .optional()
      .describe("find-replace: enable on-disk field cache."),
    exclude: z
      .array(z.string())
      .optional()
      .describe("find-replace: glob patterns to exclude."),

    // roles
    domain: z
      .string()
      .optional()
      .describe("roles: restrict to one Sitecore domain (e.g. 'sitecore')."),

    // users
    notActiveDays: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("users: inactivity threshold. Default 365."),
    includeAdmins: z
      .boolean()
      .optional()
      .describe(
        "users: include administrators in the deletion set. Strongly discouraged — opt-in only."
      ),
    includeServiceAccounts: z
      .boolean()
      .optional()
      .describe("users: include service-account names (regex-matched). Off by default."),
    useActivityDate: z
      .boolean()
      .optional()
      .describe(
        "users: use lastActivityDate instead of lastLoginDate for the inactivity check. Off by default."
      ),
  }) as const;
