/**
 * Hand-authored tool descriptions, indexed by tool name.
 *
 * Single audit point for the agent-facing copy. Style:
 *   - Action verb first.
 *   - Sentence 1: what the tool does (incl. output shape).
 *   - Sentence 2: when to reach for it (preconditions for writes,
 *     reversibility callout for destructive operations).
 *
 * No CLI flag references. No `scai` brand prefix (already namespaced
 * by tool name).
 */

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  // Bootstrap
  scai_overview:
    "Returns the server version, the bound environment name, the available tool domains, the registered Resource URIs, and whether writes are permitted. Call this first from a cold start so subsequent decisions know what surface is reachable.",
  environment_status:
    "Probes the bound environment for live health, deploy-token freshness, and the most recent deployment summary. Use this when you need a quick health pulse before scheduling work against the environment.",

  // Deploy — organization + projects + envs
  deploy_organization_inspect:
    "Fetches the organization profile, the health probe, and the active license in a single call, returning { organization, health, license }. Use this when you need a one-shot snapshot of the owning org before drilling into projects.",
  deploy_project_inspect:
    "Lists projects (no projectId) or returns the project + its environments + the project limitation (projectId given). Returns { projects } or { project, environments, limitation }. Use this to navigate from organization down to a specific project's environments.",
  deploy_project_manage:
    "Creates, updates, or deletes an XM Cloud project via a discriminated { action } input. Requires allowWrite: true. Deletes are irreversible and cascade to all environments under the project — confirm with the user before invoking the delete action.",
  deploy_environment_inspect:
    "Lists environments (no environmentId) or returns the environment + variables + recent deployments + restart status + live health probe when an environmentId is given. Use this for any read-side environment workflow before composing a write.",
  deploy_environment_lifecycle:
    "Drives environment-lifecycle writes via a discriminated { action } input — create, update, delete, restart, promote, or regenerate-context. Requires allowWrite: true. Restart and promote are recoverable; delete is irreversible and tears down all data in the env.",
  deploy_environment_variables:
    "Upserts or deletes a single environment variable identified by name and target. Requires allowWrite: true. Use this for runtime config changes; the variables list itself is reachable through deploy_environment_inspect.",
  deploy_repository_manage:
    "Links or unlinks a source-control repository ref at either scope=environment or scope=project. Requires allowWrite: true. Unlinking does not delete the repository — it stops future deploys from auto-pulling until a new link is set. Project-level links are the inherited default for newly-created environments under that project.",

  // Deploy — deployments
  deploy_run_inspect:
    "Lists recent deployments (no deploymentId) or returns the deployment + status + logs (deploymentId given). Use this to read deployment progress, surface failures to the user, or pull logs for diagnosis after a failed deploy.",
  deploy_run_start:
    "Starts a deployment for an environment against an already-uploaded source reference. Requires allowWrite: true. The MCP server does not handle the multipart upload itself — supply a sourceReference from a prior CLI-side upload.",
  deploy_run_cancel:
    "Cancels an in-flight deployment by id. Requires allowWrite: true. A cancellation request is best-effort — the underlying job may still complete if the cancel request races with the final post-deploy steps.",

  // Deploy — source control
  deploy_source_control_inspect:
    "Inspects source-control surface area via a discriminated { scope } input — integrations, providers, repository, or templates. Returns the listing or detail object that matches the requested scope. No writes; safe to call iteratively while assembling a plan.",
  deploy_source_control_manage:
    "Performs source-control writes via a discriminated { action } input — create-repository, create-repository-github, delete-integration, or validate-repository. Requires allowWrite: true. Delete-integration is destructive and severs every linked environment in one call.",

  // Serialization
  serialization_inspect:
    "Inspects the configured serialization modules for the bound environment. With a path, narrows to a single subtree explanation. Returns the module list, excluded fields, and per-subtree configuration. No tenant calls; reads only the local config and filesystem.",
  serialization_sync:
    "Synchronizes serialized items between the local filesystem and a Sitecore environment via a discriminated { direction } input — pull, push, or diff. push and diff-with-push require allowWrite: true. Long-running; finishes-then-returns (no streaming progress in v1).",
  serialization_validate:
    "Validates the serialization module configuration and the local filesystem state for the bound environment. Returns { valid, modules, errors }. Use this before serialization_sync to catch config-shape problems early.",
  serialization_publish:
    "Publishes the item at the given path (and optional descendants/languages) on the bound environment's master database. Requires allowWrite: true. Publish jobs run server-side asynchronously; the tool returns the job receipt for follow-up status checks.",

  // Recipe
  recipe_compile:
    "Compiles a recipe (file path or inline TypeScript source) to its Operation IR. Returns the IR JSON in structuredContent. Does NOT write to disk even if the CLI version supports a --output flag. No tenant access — recompile if the recipe lands in a different tenant tree.",
  recipe_diff:
    "Builds a diff plan between a recipe (or pre-compiled IR) and the bound tenant. Returns the diff plan with per-action change descriptions. Read-only; safe to call as part of an exploratory review before recipe_push.",
  recipe_plan:
    "Builds an execution plan from a pre-compiled IR against the bound tenant. Returns the plan summary + actions. Use this after recipe_compile when you want the agent to review a frozen plan before pushing.",
  recipe_push:
    "Executes a recipe against the bound tenant. Compiles in-memory if given a recipe source, plans against the tenant, then applies the plan unless whatIf is true. Requires allowWrite: true. Returns the per-action execution result list.",

  // Inspector
  tools_list:
    "Returns the names + descriptions + auth class of every tool registered on this MCP server. Use this for human debugging or when an agent needs to discover the available action surface without an external manifest.",
  tools_schema:
    "Returns the Zod-derived JSON schema for one tool (name given) or all tools. Use this when an agent's tool-use planner needs the input-shape contract beyond what list-tools exposes.",

  // Workflow
  workflow_inspect:
    "Read-side workflow surface over a discriminated { verb } input — `inspect` (auto-routes: a Workflow-templated ref returns the full definition tree (states/commands/actions/validations), any other ref returns one item's workflow + state + available commands), `list-commands` (transitions available on one item), `list-defs` (workflow definitions on the tenant), `status` (per-site rollup from XM Apps REST), or `assigned` (search items by workflow state). The `item` field on verb='inspect' accepts a GUID, content-tree path, OR a workflow display/item name (case-insensitive). Returns a discriminated `{ kind: 'item' | 'definition', ... }` envelope on the inspect verb — branch on `result.kind` before reading further. No writes; use this to plan a workflow action before invoking workflow_lifecycle.",
  workflow_lifecycle:
    "Mutating workflow surface over a discriminated { verb } input — `advance` (move one item through a named command), `reset` (force an item back to its workflow's initial state — bypasses validation actions), `bulk-advance` (sweep items matched by stale-days / from-state / root and advance each via a named command), or `apply-workflow` (attach a workflow + set initial state on an item that isn't yet under workflow). Every verb requires allowWrite: true. Pair with workflow_inspect first to confirm state shape + command names; pass the `whatIf` flag for plan-only mode where supported.",

  // Audit
  audit_inspect:
    "Read-side audit surface over a discriminated { verb } input — `list` (registered audit names), `run` (one audit, or `audit: 'all'` for the consolidated run), `history-capture` (run `all` and persist a snapshot under .scai/audit-history/), `history-list` (snapshots on disk), or `history-diff` (compare two snapshots by fingerprint). Common scope flags (root/limit/since/owner/exclude/baseline) live at the top level; audit-specific options ride along in the `auditOptions` bag. No tenant mutations — pair with audit_baseline for write-side baseline management.",
  audit_baseline:
    "Manage the per-env audit baseline file at .scai/audit-baseline-<envName>.json via a discriminated { verb } — `show` (current ignored fingerprints), `update` (run audits and fold every current finding into the baseline; pass `resetFirst: true` to replace rather than merge), `remove` (drop one fingerprint from one audit), or `reset` (clear one audit or all). Writes target the local baseline file only — never the tenant — but still require allowWrite: true so a stray call can't quietly erase an accepted-findings set.",
  audit_suite_run:
    "Execute a YAML-defined audit suite by file path. Loads the suite, applies its include/exclude + per-audit options, optionally enables baseline filtering, expands {date}/{datetime}/{env}/{suite} tokens in the output path, and runs every selected audit through `runAuditAll`. Read-only — suites themselves can't mutate the tenant. Use `only` to scope a re-run after a targeted fix.",

  // Cleanup
  cleanup_preview:
    "Plan a cleanup operation without mutating the tenant — runs the chosen `verb` with whatIf: true and returns the per-action plan list. Same input shape as cleanup_execute so the agent can show the user the diff first, then re-invoke cleanup_execute with the same arguments after authorization. Safe to call iteratively while tuning scope flags.",
  cleanup_execute:
    "Execute a destructive hygiene cleanup verb. Covers versions-prune, versions-archive, archive-purge, dead-templates, duplicates, empty-folders, find-replace, roles, site-residue, users, workflow-advance — every verb in the `scai cleanup` CLI group. Requires allowWrite: true. Honors per-verb blast-radius caps (`maxDeletions`, `limit`, `maxAdvances`) and the global `whatIf` flag for plan-only mode; pair with cleanup_preview when the user wants to see the plan before authorizing.",

  // Webhook
  webhook_inspect:
    "Read-side webhook handler surface over a discriminated { verb } input — `list` (handler items under /sitecore/system/Webhooks or a workflow state), `get` (one handler's full field detail), or `event-types` (catalog of strings the tenant accepts for the `events` field on webhook_manage create). Use `event-types` to discover valid event names BEFORE invoking webhook_manage — typos otherwise surface only at create-time with a generic 'unknown event type' error.",
  webhook_manage:
    "Mutating webhook handler surface — `create` (item/publish event handler or workflow submit/validation action) or `delete` (any webhook item by id or path). Requires allowWrite: true. Workflow webhooks attach at a workflow state's Actions subfolder; pass the state's content-tree path via `onState`.",
};

export const verifyDescriptions = (names: string[]): { missing: string[]; tooShort: string[] } => {
  const missing: string[] = [];
  const tooShort: string[] = [];
  for (const name of names) {
    const description = TOOL_DESCRIPTIONS[name];
    if (!description) {
      missing.push(name);
      continue;
    }
    if (description.length < 50) {
      tooShort.push(name);
    }
  }
  return { missing, tooShort };
};
