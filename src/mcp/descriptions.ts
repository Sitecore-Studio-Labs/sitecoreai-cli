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
