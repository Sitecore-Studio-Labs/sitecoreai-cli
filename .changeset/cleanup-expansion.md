---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Four new `scai cleanup` verbs — workflow, folders, roles, users.**
Pairs with the corresponding audit verbs.

- `cleanup workflow advance --command-name <name> --stale-days N` —
  execute a workflow command on items stuck past N days. Resolves
  the command name (e.g. "Submit", "Approve") against each item's
  workflow at its current state (via `Workflow.commands(query: {item})`),
  not workflow-wide — same workflow can expose different commands per
  state. `--from-state` scopes by current state name; `--comments`
  records an audit-trail note; `--max-advances` caps blast radius
  (default 100).
- `cleanup empty-folders purge --root <path>` — depth-first
  bottom-up cleanup of folder-like items with no children.
  Required `--root`; refuses `/sitecore/system`,
  `/sitecore/templates`, `/sitecore/layout` without `--force`.
- `cleanup roles purge-empty` — delete roles flagged by `audit
empty-roles list`. `--domain` to scope, `--max-deletions` defaults
  to 50.
- `cleanup users purge-stale --not-active-days N` — delete users
  flagged by `audit stale-users list`. **Default threshold is 365
  days** (vs 180 for the audit) since deleting users is more
  destructive than flagging them. `--max-deletions` defaults to 25.
  Administrators + likely service accounts excluded by default.

**Hygiene client extensions:** `deleteUser`, `deleteRole`,
`executeWorkflowCommand`, `getWorkflowCommandsForItem` on the
Authoring API. The `getWorkflowCommandsForItem` form passes
`query: { item: { itemId } }` to `Workflow.commands` — that argument
is required and the commands available depend on the item's current
state.

8 new unit tests (186 total in hygiene module). Live-validated all
four against the sandbox tenant (workflow advance correctly surfaced
"Basic Workflow / Draft" candidates).
