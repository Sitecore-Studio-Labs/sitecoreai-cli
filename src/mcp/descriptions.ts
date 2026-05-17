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
 *
 * Tools that front an unstable surface (brand, brief, campaign, agents —
 * reverse-engineered, no SemVer stability promise) lead with an
 * `[unstable]` tag so an agent sees the signal before selecting the
 * tool. The matching SDK subpaths live under `./unstable/*`.
 */

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  // Bootstrap
  scai_overview:
    "Returns the server version, the bound environment, the available tool domains, the registered Resource URIs, and whether writes are permitted — plus the discovery map: every configured environment and organization, each with its four-credential matrix (deploy / cmClient / brand / brief). Call this first from a cold start so subsequent decisions know what surface is reachable and which environments are credentialed.",
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

  // Recipe sync — cross-domain aggregate
  recipe_sync:
    "Pull, diff, or push every enumerable recipe kind in one call via a discriminated { verb } input — the cross-domain aggregate. `pull` enumerates every brand kit and brief type on the environment and writes each as a recipe file under the workspace directory; `status` diffs every workspace recipe against the environment; `push` converges them all (dry-run unless whatIf is false). Requires allowWrite: true — `pull` writes recipe files and `push` mutates the tenant. Reach for the per-instance brand_recipe_* / brief_recipe_* tools to target a single kit or type; use this when you want the whole environment captured or converged at once.",

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

  // Explain — composed-audit answers
  explain:
    "Answer a specific operator question by composing several audits via a discriminated { verb } input — `why-blocked` lists every inbound reference that would block a delete of `itemId` (audit references + audit template-dependencies, sorted by kind); `orphan-site` lists the residue a deleted `site` left behind and flags trees still referenced by live content (audit site-residue + audit references). Read-only. Reach for this instead of running the underlying audits by hand when triaging a failed delete or planning a site-residue cleanup.",

  // Cleanup
  cleanup_preview:
    "Plan a cleanup operation without mutating the tenant — runs the chosen `verb` with whatIf: true and returns the per-action plan list. Same input shape as cleanup_execute so the agent can show the user the diff first, then re-invoke cleanup_execute with the same arguments after authorization. Safe to call iteratively while tuning scope flags.",
  cleanup_execute:
    "Execute a destructive hygiene cleanup verb. Covers versions-prune, versions-archive, archive-purge, dead-templates, duplicates, empty-folders, find-replace, roles, site-residue, subtree, users, workflow-advance — every verb in the `scai hygiene cleanup` CLI group. Requires allowWrite: true. Honors per-verb blast-radius caps (`maxDeletions`, `limit`, `maxAdvances`) and the global `whatIf` flag for plan-only mode; pair with cleanup_preview when the user wants to see the plan before authorizing.",

  // Publishing (SAI Publishing API)
  publish_inspect:
    "Reads publishing-job state from the SAI Publishing API: a single job by id, the list of currently queued/running jobs, or the local audit log (env-level history). Use this before any cancel call so the operator knows what's in flight. Returns structured job records; never mints scope tokens (those come from CLI dry-runs, out-of-band).",
  publish_lifecycle:
    "Mutating publishing operations. v1 exposes only `cancel` — the safety-improving op that stops a running publish. Submission verbs (`submit_item` / `submit_all` / `unpublish`) are intentionally CLI-only because publishing pushes content to Experience Edge and the consent model requires a token minted from a human-driven dry-run. Use `publish_inspect verb='list-running'` to find a jobId to cancel; cancellation is recoverable via resubmission.",

  // Brief (Content Operations)
  brief_inspect:
    "[unstable] Read-side Content Operations Brief surface over a discriminated { verb } input — `list` (briefs in tenant), `show` (one brief by id, with nested to-dos/comments/references), `types` (brief schema templates with field definitions and aiIntent hints), `todos` (across briefs or filtered by briefId), or `comments` (across briefs or filtered by briefId). 'Todo' is the Content Operations UI label for the Brief API's wire `tasks` resource. No writes; safe to call as part of plan assembly before any future brief_manage operation.",
  brief_manage:
    "[unstable] Mutating Content Operations Brief surface over a discriminated { resource, verb } input. `resource: 'brief-type'` supports `create` (POST a new type from a full body), `update` (PUT-replace by id; no PATCH — read first if preserving fields), and `delete` (irreversible). `resource: 'brief'` supports `set-status` — move a brief to Draft | InReview | Approved | Canceled | Archived (a brief must leave Draft before it can be linked to a campaign) — and `delete` (irreversible; SDK `deleteBrief`). `resource: 'comment'` supports `create` — post a comment to a brief via `commentText` (UNVERIFIED: the write body is a best guess; smoke-test before relying on it). Requires allowWrite: true. Brief-type `name` must match /^[A-Za-z][A-Za-z0-9_]*$/. Brief `create` remains SDK/CLI-only.",

  // Campaign (Orchestrate)
  campaign_inspect:
    "[unstable] Read-side Orchestrate campaign surface over a discriminated { verb } input — `list` (campaigns in tenant), `show` (one campaign by id, with deliverables and tasks inline), `tasks` (tasks under a deliverable), `task` (one task by id), or `users` (the member directory that resolves the Auth0 subjects on members and assignees). A campaign is an Orchestrate `project`; projects own deliverables, deliverables own tasks. No writes.",
  campaign_manage:
    "[unstable] Mutating Orchestrate campaign surface over a discriminated { resource, verb } input — `resource: 'campaign'|'deliverable'` support verbs `create` and `delete`; `resource: 'task'` supports `create`, `update` (PUT full-replacement, no PATCH), and `delete`. Requires allowWrite: true. Deliverable/task writes need `campaignId` (and `deliverableId` for tasks); update/task-delete need `taskId`. The `delete` verb is irreversible and hits Orchestrate DELETE endpoints that were never captured during reverse-engineering — they are wired optimistically per REST conventions and remain UNVERIFIED; smoke-test before relying on them. Pass whatIf: true for a plan-only dry run.",

  // Agentic Studio
  agents_inspect:
    "[unstable] Read-side Agentic Studio surface over a discriminated { verb } input — `agents`, `skills`, `tools` (the platform tool catalog), `widgets`, `schemas`, `mcps` (registered custom MCP servers), or `status` (browser-session validity and endpoint). Returns { verb, result }. Call this to survey what an environment's Agentic Studio contains before composing a run. No writes.",
  agents_run:
    "[unstable] Runs an Agentic Studio agent by slug against a fresh space and returns the agent's streamed output collected to text. Requires allowWrite: true — a run creates a space and consumes model usage. Find the slug with agents_inspect verb='agents'.",
  agents_recipe_inspect:
    "[unstable] Pulls or diffs an Agentic Studio resource as a declarative recipe over a { kind, verb } input — `kind` is agent | skill | widget | custom-mcp; `verb='pull'` captures the resource named `name`, `verb='diff'` plans the convergence of `recipe` onto live state. Returns { kind, verb, recipe } or { kind, verb, plan }. No writes.",
  agents_recipe_push:
    "[unstable] Converges an Agentic Studio resource onto a recipe over a { kind, recipe } input. Requires allowWrite: true; pass whatIf: true for a plan-only dry run. The `agent` kind creates or updates; `skill`/`widget`/`custom-mcp` are create-only (an existing one is left unchanged).",

  // Webhook
  webhook_inspect:
    "Read-side webhook handler surface over a discriminated { verb } input — `list` (handler items under /sitecore/system/Webhooks or a workflow state), `get` (one handler's full field detail), or `event-types` (catalog of strings the tenant accepts for the `events` field on webhook_manage create). Use `event-types` to discover valid event names BEFORE invoking webhook_manage — typos otherwise surface only at create-time with a generic 'unknown event type' error.",
  webhook_manage:
    "Mutating webhook handler surface — `create` (item/publish event handler or workflow submit/validation action) or `delete` (any webhook item by id or path). Requires allowWrite: true. Workflow webhooks attach at a workflow state's Actions subfolder; pass the state's content-tree path via `onState`.",

  // Brand — Brand Management + Documents + Pipeline + Brand Review
  brand_inspect:
    "[unstable] Read-side brand kit surface over a discriminated { verb } input — list-kits, get-kit, list-sections (with names + UUIDs), list-fields (subsections with their AI intent + populated value), list-docs, get-doc (useful for polling pipeline progress). Sections only appear after BrandIngestion + EnrichSections pipelines have run; freshly-created kits return an empty section list.",
  brand_manage:
    "[unstable] Mutating brand kit surface over a discriminated { action } input — create-kit, publish-kit (PATCH status; required before pipelines populate sections), delete-kit, upload-doc (by URL only — local-file upload has no working path on the documents API), delete-doc, run-ingestion (BrandIngestionPipeline), run-enrichment (EnrichSectionsPipeline; required after ingestion to populate sections), seed (the full 7-step composite that creates + uploads + publishes + ingests + enriches + polls for completion), or update-field (direct PATCH of a single field's value, bypassing the AI pipeline — the reliable population path for AI-generated kits whose synthesized PDF didn't survive Sitecore's parser). Requires allowWrite: true. The seed action is long-running (5–15 min) and emits MCP progress notifications throughout. For agents creating kits for real brands, fetch scai://help/brand-kit-generation first — it documents BOTH the seed flow (real brand-guide PDF) and the direct-PATCH flow (synthesized / AI-generated kits, where Chrome and WeasyPrint PDFs both fail ingestion). For file format constraints see scai://help/brand-file-formats.",
  brand_review:
    "[unstable] Score content against a brand kit using AI. Returns an overall 1–5 score plus per-section + per-field breakdowns with explanations and improvement suggestions. The kit must already have populated sections — call brand_manage with action=seed (or pre-existing brand_inspect verb=list-sections on a populated kit) first. Headline agent-loop op for evaluating marketing copy, page content, or PR drafts; pair with the file path in `label` so SARIF / CI aggregators can attribute findings to source files.",
  brand_recipe_inspect:
    "[unstable] Read-side of the brand-kit recipe surface over a discriminated { verb } input. verb=pull captures a live brand kit as a declarative recipe (a clean, schema'd description — kit metadata plus section/field values, no server UUIDs). verb=diff compares a recipe against the live kit and returns the plan (create / update / noop changes). Both are read-only; neither writes. Use pull to snapshot a kit, diff to preview what a push would do.",
  brand_recipe_push:
    "[unstable] Converge a brand kit onto a declarative recipe. Computes the plan, then — unless whatIf — applies it: full orchestration via seedBrandKit (create → upload → publish → ingest → enrich) when the kit is absent, then per-field value convergence. Requires allowWrite: true to mutate; pass whatIf: true for a dry-run that returns the plan without writing. When the recipe carries documents for a not-yet-created kit, push triggers paid AI pipeline runs (~5–15 min).",
  brief_recipe_inspect:
    "[unstable] Pull or diff a Sitecore Content Operations brief type as a declarative recipe. verb='pull' captures the live brief type named `name` as a clean recipe; verb='diff' compares a given recipe against the live type and returns the convergence plan. Read-only — neither verb writes.",
  brief_recipe_push:
    "[unstable] Push a brief-type recipe — converge a Sitecore Content Operations brief type onto the given declarative recipe. Creates the brief type when absent or PUT-replaces it when present. Write tool: gated by `allowWrite`; pass `whatIf: true` for a dry-run that returns the plan without writing.",
  campaign_recipe_inspect:
    "[unstable] Pull or diff a Sitecore Orchestrate campaign as a declarative recipe. verb='pull' captures the live campaign named `campaignName` (its project, deliverables, and tasks) as a clean recipe with server ids dropped. verb='diff' compares a given recipe against the live campaign and returns the convergence plan. Neither verb writes.",
  campaign_recipe_push:
    "[unstable] Push a campaign recipe — converge a Sitecore Orchestrate campaign onto the recipe. Creates the campaign when absent, creates missing deliverables and tasks, and updates existing tasks. Additive: a recipe omitting a deliverable or task never removes it. Gated by `allowWrite`; `whatIf` returns the plan without writing.",
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
