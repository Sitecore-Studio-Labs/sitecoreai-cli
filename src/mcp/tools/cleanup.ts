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
 * Verbs map 1:1 with the `scai cleanup` CLI verbs whose library task
 * honors `--what-if`. The interactive-keep mode for `duplicates` stays
 * CLI-only because it requires per-group keystroke selection.
 */

import { z } from "zod";
import { runCleanupArchivePurge } from "@/hygiene/tasks/cleanup-archive-purge";
import { runCleanupDeadTemplates } from "@/hygiene/tasks/cleanup-dead-templates";
import { runCleanupDuplicates } from "@/hygiene/tasks/cleanup-duplicates";
import { runCleanupEmptyFolders } from "@/hygiene/tasks/cleanup-empty-folders";
import { runCleanupFieldSet } from "@/hygiene/tasks/cleanup-field-set";
import { runCleanupFindReplace } from "@/hygiene/tasks/cleanup-find-replace";
import { runCleanupLanguageVersionAdd } from "@/hygiene/tasks/cleanup-language-version-add";
import { runCleanupPublish } from "@/hygiene/tasks/cleanup-publish";
import { runCleanupRename } from "@/hygiene/tasks/cleanup-rename";
import { runCleanupRoles } from "@/hygiene/tasks/cleanup-roles";
import { runCleanupSiteResidue } from "@/hygiene/tasks/cleanup-site-residue";
import { runCleanupSubtree } from "@/hygiene/tasks/cleanup-subtree";
import { runCleanupUsers } from "@/hygiene/tasks/cleanup-users";
import { runCleanupVersionsArchive } from "@/hygiene/tasks/cleanup-versions-archive";
import { runCleanupVersionsPrune } from "@/hygiene/tasks/cleanup-versions-prune";
import { runCleanupWorkflowAdvance } from "@/hygiene/tasks/cleanup-workflow-advance";
import { runCleanupWorkflowApply } from "@/hygiene/tasks/cleanup-workflow-apply";
import { ensureMcpElevationAllowed } from "@/shared/allow-write";
import { createScaiError } from "@/shared/errors";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, whatIfShape } from "../schemas/common";

/**
 * Loose-typed runner shape. The MCP boundary hands every runner an
 * untyped `Record<string, unknown>` option bag; the routing table
 * forwards verbatim.
 */
type LoosedRunner = (options: Record<string, unknown>) => Promise<readonly unknown[]>;

/**
 * Convert a typed runner into the loose-typed dispatch shape. Replaces
 * the prior `as never` casts. Still an unsafe cast at its core, but
 * localized to one helper *and* the caller's runner is required to
 * return `Promise<readonly X[]>` — so if a runner is refactored to
 * return a non-array (the way `runCleanupDeadTemplates` historically
 * did), the call to `loosen` fails type-check and surfaces the bug
 * here instead of leaking into the dispatch path.
 */
const loosen = <O>(fn: (options: O) => Promise<readonly unknown[]>): LoosedRunner =>
  fn as unknown as LoosedRunner;

/**
 * Cleanup verb registry — verb name → task runner. Each runner accepts
 * an option bag whose shape varies per verb; the input schema below
 * documents which options each verb honors.
 *
 * Dead-templates returns `{templates, folders}` rather than a flat
 * array, so it gets an inline flatten so the dispatch handler can treat
 * every runner's output uniformly (`actions.length`, iterable for
 * `summarizeActions`).
 */
const CLEANUP_RUNNERS: Record<string, LoosedRunner> = {
  "versions-prune": loosen(runCleanupVersionsPrune),
  "versions-archive": loosen(runCleanupVersionsArchive),
  "archive-purge": loosen(runCleanupArchivePurge),
  "dead-templates": loosen(async (options: Parameters<typeof runCleanupDeadTemplates>[0]) => {
    const r = await runCleanupDeadTemplates(options);
    return [...r.templates, ...r.folders.map((f) => ({ ...f, kind: "folder" as const }))];
  }),
  duplicates: loosen(runCleanupDuplicates),
  "empty-folders": loosen(runCleanupEmptyFolders),
  "field-set": loosen(runCleanupFieldSet),
  "find-replace": loosen(runCleanupFindReplace),
  "language-versions-add": loosen(runCleanupLanguageVersionAdd),
  publish: loosen(runCleanupPublish),
  rename: loosen(runCleanupRename),
  roles: loosen(runCleanupRoles),
  "site-residue": loosen(runCleanupSiteResidue),
  subtree: loosen(async (options: Parameters<typeof runCleanupSubtree>[0]) => {
    const r = await runCleanupSubtree(options);
    // Flatten the {blockers, deletions} envelope so the MCP dispatch
    // handler's `actions.length` matches the user-visible work.
    return [
      ...r.blockers.map((b) => ({ ...b, kind: "blocker" as const })),
      ...r.deletions.map((d) => ({ ...d, kind: "deletion" as const })),
    ];
  }),
  users: loosen(runCleanupUsers),
  "workflow-advance": loosen(runCleanupWorkflowAdvance),
  "workflow-apply": loosen(runCleanupWorkflowApply),
};

/**
 * Verbs whose underlying library expects `root` as a `string[]` (extra
 * roots beyond the SXA defaults) rather than the usual single
 * content-tree path. The top-level `root` field is omitted for these
 * — callers pass the array via `extraRoots`.
 */
const ROOT_AS_ARRAY_VERBS = new Set(["site-residue"]);

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
    case "workflow-advance":
      if (!input.commandName) {
        throw createScaiError("verb='workflow-advance' requires `commandName`.", "INPUT_INVALID");
      }
      break;
    case "workflow-apply":
      if (!input.workflow) {
        throw createScaiError("verb='workflow-apply' requires `workflow`.", "INPUT_INVALID");
      }
      break;
    case "field-set":
      if (!input.field) {
        throw createScaiError("verb='field-set' requires `field`.", "INPUT_INVALID");
      }
      if (input.mode !== "clear" && (input.value === undefined || input.value === null)) {
        throw createScaiError(
          `verb='field-set' requires \`value\` (mode='${(input.mode as string) ?? "replace"}').`,
          "INPUT_INVALID"
        );
      }
      break;
    case "publish":
      if (!input.items && !input.root) {
        throw createScaiError("verb='publish' requires `items` or `root`.", "INPUT_INVALID");
      }
      break;
    case "rename":
      if (!input.pattern || input.replacement === undefined) {
        throw createScaiError(
          "verb='rename' requires `pattern` and `replacement`.",
          "INPUT_INVALID"
        );
      }
      break;
    case "language-versions-add":
      if (!input.languages) {
        throw createScaiError(
          "verb='language-versions-add' requires `languages`.",
          "INPUT_INVALID"
        );
      }
      break;
  }
};

const summarizeActions = (verb: string, actions: readonly unknown[]): string => {
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
  const rootAsArray = ROOT_AS_ARRAY_VERBS.has(verb);
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === "verb" || k === "whatIf" || k === "allowWrite") continue;
    // Skip the top-level `root` (string) for verbs that expect an array;
    // the `extraRoots` field below feeds it instead.
    if (rootAsArray && k === "root") continue;
    if (k === "extraRoots") {
      if (rootAsArray) merged.root = v;
      continue;
    }
    merged[k] = v;
  }
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
      // Per-env opt-out for MCP-elevated writes. Only enforced when this
      // call would actually mutate the tenant — what-if previews are
      // read-only and always permitted.
      if (!whatIf) {
        ensureMcpElevationAllowed(context.resolved.root, context.envName);
      }
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
        "field-set",
        "find-replace",
        "language-versions-add",
        "publish",
        "rename",
        "roles",
        "site-residue",
        "subtree",
        "users",
        "workflow-advance",
        "workflow-apply",
      ])
      .describe(
        "Which cleanup operation to run. Each verb maps 1:1 to a `scai cleanup …` CLI command and shares its option contract. Mostly destructive — pair with cleanup_preview first, or pass `whatIf: true`. Required fields per verb: versions-prune/versions-archive (`keep`, `root`); empty-folders (`root`); field-set (`field`; `value` unless mode='clear'); find-replace (`pattern`, `replacement`); language-versions-add (`languages`); publish (`items` OR `root`); rename (`pattern`, `replacement`); subtree (`path`); workflow-advance (`commandName`); workflow-apply (`workflow`). site-residue extends the SXA Project defaults via `extraRoots` (its underlying option is `string[]`, not the top-level `root`). subtree refuses by default when external items reference the deletion target — pass `orphanExternalRefs: 'clear'` to empty those fields first. All others have safe defaults but accept the same option bag."
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
    archiveName: z.string().optional().describe("archive-purge: limit to one archive name."),
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
      .describe("Blast-radius cap. Default per-verb (empty-folders 500, roles 50, users 25)."),

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
    fields: z.array(z.string()).optional().describe("find-replace: restrict to these field names."),
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
    cache: z.boolean().optional().describe("find-replace: enable on-disk field cache."),
    exclude: z.array(z.string()).optional().describe("find-replace: glob patterns to exclude."),

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

    // subtree
    path: z
      .string()
      .optional()
      .describe(
        "subtree: content-tree path of the subtree root to delete. Required for subtree."
      ),
    scanRoot: z
      .string()
      .optional()
      .describe(
        "subtree: content root scanned for inbound references. Default `/sitecore` (entire CMS). Narrow for speed at the cost of missing refs outside the chosen root."
      ),
    orphanExternalRefs: z
      .enum(["clear", "prune", "leave"])
      .optional()
      .describe(
        "subtree: how to handle external items whose fields reference the subtree. Omit (default) = refuse with blocker list. 'clear' empties the entire referring field. 'prune' surgically removes only the offending entries (preserves siblings in multi-list / treelist fields and `<r>` elements in `__Renderings` XML); falls back to clear for single-value fields. 'leave' skips the inbound-ref scan entirely — fastest mode; accepts dangling refs and expects an `audit broken-links` follow-up. Use --what-if first to preview the non-`leave` modes."
      ),

    // site-residue
    extraRoots: z
      .array(z.string())
      .optional()
      .describe(
        "site-residue: additional roots to scan beyond the SXA Project defaults (templates/Project, layout/Renderings/Project, media library/Project). Replaces the top-level `root` for this verb."
      ),
    contentRoot: z
      .string()
      .optional()
      .describe(
        "site-residue: override the content root walked when discovering active sites. Default `/sitecore/content`."
      ),
    skipRefCheck: z
      .boolean()
      .optional()
      .describe(
        "site-residue: skip the inbound-ref pre-flight that protects active content from broken links. Faster but loses the safety net — pair with a separate `audit broken-links` run."
      ),

    // workflow-advance
    commandName: z
      .string()
      .optional()
      .describe(
        "workflow-advance: workflow command to execute (case-insensitive, e.g. 'Submit', 'Approve'). Required for workflow-advance."
      ),
    comments: z
      .string()
      .optional()
      .describe("workflow-advance: comment recorded with the workflow execution (audit trail)."),
    staleDays: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("workflow-advance: items not updated for this many days are eligible. Default 30."),
    maxAdvances: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("workflow-advance: cap on items advanced per run. Default 100."),
    fromState: z
      .string()
      .optional()
      .describe(
        "workflow-advance: restrict to items currently in this workflow state (e.g. 'Draft')."
      ),

    // workflow-apply
    //
    // Note: `staleDays` (above) is shared with workflow-apply where it
    // means "only attach to items not updated for N days" (optional;
    // omit to attach to every match). Other workflow-advance fields
    // are not reused — workflow-apply does not need `commandName`,
    // `comments`, `maxAdvances`, or `fromState`.
    workflow: z
      .string()
      .optional()
      .describe(
        "workflow-apply: workflow GUID, content-tree path, or display/item name (case-insensitive). Required for workflow-apply."
      ),
    state: z
      .string()
      .optional()
      .describe(
        "workflow-apply: target state (GUID or state name). Defaults to the workflow's __Initial state."
      ),
    template: z
      .string()
      .optional()
      .describe(
        "workflow-apply: only attach to items conforming to this template (GUID or absolute /sitecore/templates path). Omit to attach to every item under `root`."
      ),
    reattach: z
      .boolean()
      .optional()
      .describe(
        "workflow-apply: overwrite items already attached to a different workflow. Off by default — already-attached items are skipped so the verb defaults to a safe backfill."
      ),
    maxApplies: z
      .number()
      .int()
      .positive()
      .max(10000)
      .optional()
      .describe("workflow-apply: cap on items attached per run. Default 100."),

    // field-set
    field: z
      .string()
      .optional()
      .describe(
        "field-set: name of the single field to write (case-insensitive, resolved against the item's template). Required for field-set."
      ),
    value: z
      .string()
      .optional()
      .describe(
        "field-set: value to write. mode='replace' writes verbatim; mode='add'/'remove' parse it as a comma- or pipe-separated GUID list. Ignored for mode='clear'."
      ),
    mode: z
      .enum(["replace", "add", "remove", "clear"])
      .optional()
      .describe(
        "field-set: how to combine `value` with the existing field state. `replace` (default) overwrites; `add` unions GUIDs into a pipe-delimited list (this is the answer to bulk tag-add); `remove` subtracts GUIDs; `clear` wipes the field. add/remove reject fields whose existing value isn't a pipe-delimited GUID list to prevent corrupting text fields."
      ),
    templatePattern: z
      .string()
      .optional()
      .describe(
        "field-set / rename / language-versions-add: restrict to items whose templateName matches this regex. Strongly recommended — without it the verb operates on every item in --root."
      ),
    whereCurrentMatches: z
      .string()
      .optional()
      .describe(
        "field-set: only update items whose current value of `field` matches this regex (e.g. '^$' for empty-only). Enables idempotent fill-the-blank workflows."
      ),
    maxMutations: z
      .number()
      .int()
      .positive()
      .max(50_000)
      .optional()
      .describe("field-set: cap on items mutated per run. Default 100."),

    // publish
    items: z
      .array(z.string())
      .optional()
      .describe(
        "publish: explicit item IDs or content-tree paths to publish. Mutually exclusive with `root`."
      ),
    languages: z
      .array(z.string())
      .optional()
      .describe(
        "publish: language codes to publish (default: tenant primary). language-versions-add: language codes to create versions in (required)."
      ),
    target: z
      .string()
      .optional()
      .describe("publish: publish target name (e.g. 'web'). Default: all configured."),
    republish: z
      .boolean()
      .optional()
      .describe("publish: re-publish unchanged items. Default false."),
    maxPublishes: z
      .number()
      .int()
      .positive()
      .max(50_000)
      .optional()
      .describe("publish: cap on items published per run. Default 1000."),
    pollTimeoutMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "publish: poll publishingStatus until completion or this timeout. Default 0 = fire-and-return."
      ),
    pollIntervalMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("publish: poll cadence in ms when pollTimeoutMs > 0. Default 2000."),

    // rename (pattern / replacement / flags / literal / ignoreCase are declared above under find-replace)
    maxRenames: z
      .number()
      .int()
      .positive()
      .max(10_000)
      .optional()
      .describe("rename: cap on items renamed per run. Default 100."),

    // language-versions-add
    fromLanguage: z
      .string()
      .optional()
      .describe(
        "language-versions-add: source language to copy fields from. Default: seed the new version empty."
      ),
    maxAdds: z
      .number()
      .int()
      .positive()
      .max(50_000)
      .optional()
      .describe(
        "language-versions-add: cap on (item, language) versions created per run. Default 500."
      ),
  }) as const;
