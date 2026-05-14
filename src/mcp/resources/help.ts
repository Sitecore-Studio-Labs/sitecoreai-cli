/**
 * `scai://help/*` resources — agent-discoverable documentation.
 *
 * The text content is intentionally compact so the agent can fetch the
 * whole resource without blowing up its context. For exhaustive prose
 * the agent should fall back to the project docs (linked from the
 * overview resource).
 */

import type { McpRegistry } from "../registry";

const OVERVIEW_TEXT = `# scai MCP server — overview

scai is the developer-side MCP for Sitecore XM Cloud. It is intentionally
complementary to Sitecore's managed Marketer MCP: the marketer surface
operates pages, components, and content from the marketer's vantage
point; the scai surface operates **the developer-facing primitives** —
deployment runs, environment lifecycle, source-control bindings,
serialization (.scs) sync, and Recipe DSL execution.

## Binding model

One MCP process is bound to one Sitecore environment at startup
(\`scai mcp serve --environment-name <env>\`). Multi-env workflows run
multiple processes — there is no in-protocol switch.

## Write gate

Every write tool has \`allowWrite: boolean\` in its input schema. The
dispatcher rejects \`allowWrite: false\` before any side effect runs.
There is no session-wide override and no per-environment "allow all"
toggle in v1 — \`allowWrite\` is a per-call consent step.

## Tool surface

Tools are **workflow-shaped**, not 1:1 wrappers of the library:

- \`*_inspect\` tools fan out reads and return a consolidated snapshot.
- \`*_manage\` / \`*_lifecycle\` tools take a discriminated \`action\`
  input and route to the appropriate write primitive.

See \`tools_list\` and \`tools_schema\` for the live inventory.

## Resources

- \`scai://help/overview\` — this resource.
- \`scai://help/recipes-grammar\` — Recipe DSL grammar synopsis.
- \`scai://help/deploy-lifecycle\` — XM Cloud deploy state machine.
- \`scai://help/sitecore-apis\` — curated index of Sitecore APIs with
  links into api-docs.sitecore.com and per-API tool mappings.
- \`scai://env/current/manifest\` — bound environment metadata.
- \`scai://env/current/last-deploy\` — most recent deployment summary.
- \`https://api-docs.sitecore.com/\` — external pointer to the full
  Sitecore API docs site (clients that resolve https:// URIs natively
  can fetch directly).

## Prompts

Slash commands available in compatible clients:

- \`scai.deploy_recipe(recipeName, targetEnv)\`
- \`scai.diff_envs(sourceEnv, targetEnv)\`
- \`scai.recover_failed_deploy(deploymentId?)\`

## Known limitations (v1)

- stdio transport only; HTTP/SSE deferred to v2.
- Tool calls serialize through a single mutex; no parallel dispatch.
- No cancellation (\`recipe_push\`, \`serialization_sync\` finish-then-return).
- No streaming partial results.
- No \`watch\` tools.
`;

const RECIPES_GRAMMAR_TEXT = `# scai Recipes — grammar synopsis

A Recipe is a typed declarative document that compiles to an Operation
Intermediate Representation (IR) which the executor applies to a
Sitecore tenant. Recipes never describe mutations directly — they
describe **desired shape** (templates, fields, renderings, content
items, page designs, sites) and the compiler turns the shape into an
Op IR that the planner diffs against the live tenant.

## Top-level kinds

- \`component-template\` — Component data + parameters templates.
- \`component-section\` — Section folder for grouping components.
- \`content-template\` — Content template with field shapes.
- \`content-item\` — Content item under \`contentItemsRoot\`.
- \`design-parameters-template\` — Presentation parameter template.
- \`section-definition\` — Section grouping for a template.
- \`partial-design\` — Partial design composition.
- \`page-design\` — Page design composition.
- \`site-template\` — Site template (dictionaries + taxonomies).
- \`site\` — Site root + grouping.
- \`enumeration\` — Reusable enumeration list.

## Common shape

Every recipe carries:

- \`kind: <one of above>\`
- \`handle: "<unique-slug>"\` — author-stable identifier; the planner
  uses this to recognise the same recipe across pushes.
- \`meta: { name, description?, icon? }\`
- Kind-specific body.

## Refs

Recipes reference each other (and Sitecore items) via \`RefValue\`s:

- \`{ kind: "handle", handle: "other-recipe@1" }\` — cross-recipe ref.
- \`{ kind: "path", path: "/sitecore/templates/..." }\` — direct path.
- \`{ kind: "id", id: "<guid>" }\` — direct id.

## Push lifecycle

1. \`recipe_compile\` — recipe → IR (no tenant calls).
2. \`recipe_plan\` — IR + tenant → planned actions (no writes).
3. \`recipe_diff\` — alias for plan (whatIf mode of push).
4. \`recipe_push\` — apply (whatIf or live). Each apply emits per-op
   execution events that the tool surfaces back as part of the result.

For the canonical type definitions, see the \`@sitecoreai-labs/sitecoreai-cli/recipe\`
public API — the schemas exported there are the source of truth.
`;

const DEPLOY_LIFECYCLE_TEXT = `# XM Cloud deploy state machine

scai surfaces the Deploy API as a tiered hierarchy:

\`\`\`
organization → project → environment → deployment → logs
\`\`\`

## Organization
- \`deploy_organization_inspect\` — org profile + health + license.

## Project
- A container for environments. Has a default repo link inherited by
  newly-created environments (\`deploy_project_repository\`).
- \`deploy_project_inspect\` — list or detail.
- \`deploy_project_manage\` — create / update / delete.

## Environment
- The XM Cloud tenant. CM host + variables + repo binding.
- \`deploy_environment_inspect\` — environment + variables + recent
  deployments + restartStatus + live /healthz/ready probe.
- \`deploy_environment_lifecycle\` — create / update / delete / restart /
  promote / regenerate-context.
- \`deploy_environment_variables\` — variable upsert / delete.
- \`deploy_environment_repository\` — link / unlink repo.

## Deployment
- A source-bundle apply to an environment. Has a status pipeline:
  \`Created → InProgress → Complete | Failed | Cancelled\`.
- \`deploy_run_inspect\` — list or detail + logs.
- \`deploy_run_start\` — start (new env deployment or re-deploy
  existing).
- \`deploy_run_cancel\` — best-effort cancel.

## Source control
- Repositories + integrations + providers + templates.
- \`deploy_source_control_inspect\` — scoped read.
- \`deploy_source_control_manage\` — create / delete / validate.

## Failure / recovery

When a deployment fails:

1. \`deploy_run_inspect\` with the failed deploymentId + includeLogs.
2. If the issue is environment-level (e.g. broken context), call
   \`deploy_environment_lifecycle action=regenerate-context\` and retry
   with \`deploy_run_start\`.
3. If the issue is config (env var missing), call
   \`deploy_environment_variables action=upsert\`, then restart with
   \`deploy_environment_lifecycle action=restart\` if needed.

See the \`scai.recover_failed_deploy\` prompt for a guided remediation
flow.
`;

const SITECORE_APIS_TEXT = `# Sitecore API catalog — curated index for scai

Sitecore documents ~26 REST and GraphQL APIs at
[api-docs.sitecore.com](https://api-docs.sitecore.com/). This resource
is a **curated subset**: the APIs scai's library wraps or surfaces, with
deep links into the official docs. Fetch this resource when you need to
understand the wire-level contract behind one of scai's tools, or
identify an API that scai doesn't yet surface.

## APIs scai uses directly

### XM Cloud Deploy API
- **Base URL:** \`https://xmclouddeploy-api.sitecorecloud.io\`
- **Docs:** [api-docs.sitecore.com/xm-cloud-deploy](https://api-docs.sitecore.com/xm-cloud-deploy)
- **scai tools:** every \`deploy_*\` tool.
- **What it does:** organizations / projects / environments / deployments
  / environment variables / source-control bindings / restart + promote
  lifecycle.

### Authoring & Management GraphQL API
- **Endpoint pattern:** \`https://<cmHost>/sitecore/api/authoring/graphql/v1\`
- **Docs:** [api-docs.sitecore.com/authoring-and-management](https://api-docs.sitecore.com/authoring-and-management)
- **scai tools:** \`serialization_*\` (read/write item operations),
  \`recipe_diff\` / \`recipe_plan\` / \`recipe_push\` (write Authoring side).
- **What it does:** item + template + rendering CRUD; role + user
  CRUD; publish triggers; the canonical authoring write surface for
  Sitecore Content Hub.

### Sites API
- **Base URL pattern:** tenant-bound via the bound environment.
- **Docs:** [api-docs.sitecore.com/sites](https://api-docs.sitecore.com/sites)
- **scai tools:** indirectly by recipe handlers (site creation, site
  template binding).
- **What it does:** site collection + site item + language + grouping
  operations.

### SAI Publishing API
- **Base URL:** \`https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs\`
- **Docs:** [api-docs.sitecore.com/sai/publishing-api](https://api-docs.sitecore.com/sai/publishing-api)
- **scai tools:** none yet — \`serialization_publish\` currently
  publishes via the Authoring GraphQL \`publish()\` mutation; the SAI
  Publishing API is planned for the dedicated \`scai publish\` command
  group.
- **What it does:** publish-to-Edge job lifecycle (start, status,
  cancel, list, summary).

## APIs scai does NOT surface (yet)

These are documented in the Sitecore catalog but are out of scope for
the v1 MCP surface:

- **Edge Delivery API** — read-only headless content. Marketer
  delivery surface; not a scai concern.
- **Pages API** — Marketer-facing page composition (the Marketer
  MCP's primary surface).
- **Forms API** — Sitecore Forms; not in scai's scope.
- **Search API** — Sitecore Search; not in scai's scope.

## Why use this resource

- **Naming hints:** match a scai tool to its underlying API endpoint.
- **Capability gaps:** identify an API operation scai doesn't yet
  expose; surface it as a feature request.
- **Wire-level debugging:** when a tool returns a network error, the
  underlying endpoint and its docs are linked here.

See the companion resource at \`https://api-docs.sitecore.com/\` for the
full external docs index (clients with HTTP-resource support can fetch
it directly).
`;

export const registerHelpResources = (registry: McpRegistry): void => {
  registry.registerResource({
    uri: "scai://help/overview",
    name: "scai overview",
    description:
      "Markdown overview of the scai MCP server, the binding model, the write gate, and the v1 limitations.",
    mimeType: "text/markdown",
    handler: async () => ({
      contents: [
        {
          uri: "scai://help/overview",
          mimeType: "text/markdown",
          text: OVERVIEW_TEXT,
        },
      ],
    }),
  });

  registry.registerResource({
    uri: "scai://help/recipes-grammar",
    name: "scai recipes grammar",
    description: "Markdown synopsis of the scai Recipe DSL grammar — kinds, refs, push lifecycle.",
    mimeType: "text/markdown",
    handler: async () => ({
      contents: [
        {
          uri: "scai://help/recipes-grammar",
          mimeType: "text/markdown",
          text: RECIPES_GRAMMAR_TEXT,
        },
      ],
    }),
  });

  registry.registerResource({
    uri: "scai://help/deploy-lifecycle",
    name: "XM Cloud deploy lifecycle",
    description:
      "Markdown reference for the XM Cloud deploy state machine surfaced through the deploy_* tools.",
    mimeType: "text/markdown",
    handler: async () => ({
      contents: [
        {
          uri: "scai://help/deploy-lifecycle",
          mimeType: "text/markdown",
          text: DEPLOY_LIFECYCLE_TEXT,
        },
      ],
    }),
  });

  registry.registerResource({
    uri: "scai://help/sitecore-apis",
    name: "Sitecore API catalog",
    description:
      "Curated index of Sitecore REST + GraphQL APIs with deep links to api-docs.sitecore.com — names the APIs scai's tools wrap, plus the APIs scai does not yet surface.",
    mimeType: "text/markdown",
    handler: async () => ({
      contents: [
        {
          uri: "scai://help/sitecore-apis",
          mimeType: "text/markdown",
          text: SITECORE_APIS_TEXT,
        },
      ],
    }),
  });

  // Companion external pointer. Compatible MCP clients that resolve
  // https:// resource URIs natively can fetch the docs root directly;
  // clients that don't will still see the URI in resources/list and
  // can navigate to it themselves.
  registry.registerResource({
    uri: "https://api-docs.sitecore.com/",
    name: "Sitecore API docs (external)",
    description:
      "Direct https:// URI for the Sitecore API documentation site. Companion to scai://help/sitecore-apis — fetch this when you need the full external catalog beyond what scai's curated index covers.",
    mimeType: "text/html",
    handler: async () => ({
      contents: [
        {
          uri: "https://api-docs.sitecore.com/",
          mimeType: "text/plain",
          text: "Sitecore API documentation: https://api-docs.sitecore.com/. Fetch this URL directly for the full catalog of ~26 documented REST + GraphQL APIs. For a scai-curated subset with tool mappings, read scai://help/sitecore-apis instead.",
        },
      ],
    }),
  });
};
