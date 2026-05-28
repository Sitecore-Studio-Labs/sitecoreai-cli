/**
 * MCP resources for the recipe kinds that have non-trivial runtime
 * behavior (currently: workflow + webhook-authorization). Agents call
 * `resources/read` to fetch these when composing or troubleshooting a
 * recipe.
 *
 * Hand-authored summaries — kept in sync with `docs/recipes/workflow.md`
 * which is the source of truth for repo readers. Why duplicate: the
 * `docs/` tree isn't shipped in the npm package, so reading it from
 * disk at fetch time doesn't work in production installs.
 */

import type { McpRegistry } from "../registry";

const WORKFLOW_RECIPE_REFERENCE_TEXT = `# Workflow recipes — MCP reference

Two recipe kinds let an agent define a complete Sitecore workflow as
data: \`workflow\` (the workflow itself + states + commands + webhook
actions) and \`webhook-authorization\` (reusable Authorization items).

## Runtime model

A command execution runs in this order:

1. Validation actions attached to the **command** are POSTed in order.
   Each must return \`{ IsValid: boolean, Message: string }\`. The first
   \`IsValid: false\` aborts the transition.
2. The item's \`__Workflow state\` field is updated to the target state.
3. Submit actions attached to the **new state** are POSTed (fire-and-
   forget; their response is logged but doesn't roll back).

| Recipe field | Attaches at | Kind | Fires when |
| --- | --- | --- | --- |
| \`state.actions[]\` | A workflow state | submit OR validation | Item enters the state (post-transition) |
| \`state.commands[].validations[]\` | A workflow command | validation only | Command invoked, before transition completes |

Common pattern: validations on commands (synchronous gates), submit
actions on states (fire-and-forget notifications).

## Endpoint contract

### Submit action

POST to the URL with JSON body. Response not inspected. Non-2xx logged
but transition has already happened. No automatic retry.

### Validation action

POST to the URL with same JSON body. Response **must** be JSON with
\`IsValid\` + \`Message\` (PascalCase). Anything else (timeout, HTTP
error, missing field) is treated as \`IsValid: false\` — the gate fails
closed. Default timeout 15s.

### Payload shape (verify against your tenant)

\`\`\`jsonc
{
  "EventName": "workflow:command:executed",
  "ItemId": "{...}",
  "ItemPath": "/sitecore/content/...",
  "ItemLanguage": "en",
  "ItemVersion": 3,
  "TemplateId": "{...}",
  "TemplateName": "Article",
  "WorkflowId": "{...}",
  "WorkflowName": "Editorial",
  "PreviousStateId": "{...}", "PreviousStateName": "Draft",
  "NewStateId": "{...}", "NewStateName": "In Review",
  "CommandId": "{...}", "CommandName": "Submit",
  "Comments": "...",
  "User": { "Name": "sitecore\\\\admin", "Email": "..." },
  "Timestamp": "2026-05-14T12:34:56Z"
}
\`\`\`

Field names + casing have shifted between Sitecore versions. Log the
first real call your endpoint receives and pin schema validators
accordingly.

## Authorization types

Three auth types ship with Sitecore. Recipe shape and wire behavior:

| Type | Recipe \`auth\` object | Wire behavior |
| --- | --- | --- |
| \`ApiKey\` | \`{ type, headerName, key: "$ENV:VAR" }\` | Adds a custom header per the configured name. |
| \`Basic\` | \`{ type, username, password: "$ENV:VAR" }\` | Adds \`Authorization: Basic <base64>\`. |
| \`OAuth2ClientCredentialsGrant\` | \`{ type, tokenEndpoint, clientId, clientSecret: "$ENV:VAR", scope?, audience? }\` | Mints a token; sets \`Authorization: Bearer\`. Sitecore-side caching is undocumented — assume per-fire mint. |

Secrets are always \`$ENV:VAR_NAME\` references. The recipe file never
carries plaintext credentials; the executor resolves at apply time.
Missing env vars surface as a plan-phase error.

Actions reference an Authorization via either \`authorizationRef\`
(handle of a webhook-authorization recipe pushed in the same set) OR
\`authorizationPath\` (absolute path to an existing tenant item). Use
exactly one per action.

## Recipe shapes

### \`workflow\`

\`\`\`ts
{
  kind: "workflow",
  schemaVersion: "1",
  handle: "blog-article-approval@1",
  name: "BlogArticleApproval",
  displayName: "Blog Article Approval",
  description?: "...",
  meta?: { tax?: { group?: "Editorial" } },  // → /sitecore/system/Workflows/Editorial/<name>
  initialState: "draft",                     // must match a state.key
  states: [
    {
      key: "draft",                          // kebab-case; seeds GUID
      name: "Draft",
      displayName: "Draft",
      final?: false,                         // workflow terminates here
      preview?: false,                       // appears in preview DB
      actions?: [                            // state-entry
        {
          kind: "webhook-submit" | "webhook-validation",
          key: "notify-reviewer",
          url: "https://...",
          displayName?, description?, enabled?,
          serializationType?: "JSON" | "XML",
          authorizationRef?: "ci-bearer@1",  // OR
          authorizationPath?: "/sitecore/...", // exactly one
        }
      ],
      commands?: [
        {
          key: "submit",
          name: "Submit",
          displayName: "Submit for Review",
          nextState: "in-review",            // must match another state.key
          autoPublish?: false,
          suppressComment?: false,
          appearanceEvaluator?: "default" | "lock" | "unlock",
          secured?: false,                   // reserved; no-op today
          validations?: [                    // synchronous gates
            { kind: "webhook-validation", key, url, authorizationRef? }
          ]
        }
      ]
    }
  ],
  bindings?: { templates: [] }               // reserved; INPUT_INVALID if non-empty
}
\`\`\`

### \`webhook-authorization\`

\`\`\`ts
{
  kind: "webhook-authorization",
  schemaVersion: "1",
  handle: "ci-bearer@1",
  name: "CI Bearer",
  displayName: "CI Bearer Token",
  description?: "...",
  auth: { type: "ApiKey" | "Basic" | "OAuth2ClientCredentialsGrant", ... }
}
\`\`\`

## Recipe → Sitecore content-tree mapping

| Recipe field | Sitecore path | Template |
| --- | --- | --- |
| \`meta.tax.group\` | \`/sitecore/system/Workflows/<group>/\` | Workflow Folder (CreateOnly) |
| \`name\` | \`/sitecore/system/Workflows/[<group>/]<name>\` | Workflow |
| \`states[].name\` | \`.../<state.name>\` | State |
| \`commands[].name\` | \`.../<state.name>/<cmd.name>\` | Command |
| \`actions[].key\` | \`.../<state.name>/<action.key>\` | Webhook Submit/Validation Action |
| \`validations[].key\` | \`.../<cmd.name>/<val.key>\` | Webhook Validation Action |
| webhook-authorization | \`/sitecore/system/Settings/Webhooks/Authorizations/<name>\` | Api Key / Basic / OAuth2 Client Credentials Grant |

State/command/action children are direct children — no \`Actions/\`
subfolder. \`key\` and \`name\` must be unique among siblings.

## Failure modes

| Scenario | What happens |
| --- | --- |
| Validation returns \`IsValid: false\` | Transition aborts; Message surfaces. Item stays in current state. |
| Validation returns non-JSON / 4xx-5xx / timeout | Same — fails closed. Default 15s timeout (not configurable from recipe). |
| Submit returns non-2xx | Logged. Transition already complete; no rollback. |
| Submit times out | Same — log + continue. No retries. |
| Missing \`$ENV:VAR\` at push | Plan-phase error before any write. |
| Authorization deleted post-bind | Action fires unauthenticated; endpoint rejects. Silent for submit, blocks transition for validation. |

No built-in retry queue. For at-least-once submit delivery, set up an
idempotent receiver and external reconciliation.

## Troubleshooting

**templateOf path '/sitecore/templates/System/Workflow/Webhook Submit Action' did not resolve**

Tenant either pre-dates the webhook-actions templates or has a custom
layout. Run \`scai content workflow get "Sample Workflow"\` — if its
actions are templated \`Webhook Submit Action\`, the templates exist
somewhere else; PR an update to \`TEMPLATE_PATHS\` in
\`src/recipe/compile/workflow.ts\`. Otherwise strip \`actions\` /
\`validations\` from the recipe.

**Validation always blocks**

Endpoint response shape wrong. \`IsValid\` / \`Message\` (PascalCase)
required. Anything else → fail closed.

**Plan-mode skip "Target item (refKey X) not yet captured/created"**

Plan-mode-only artifact for SetField ops pointing at items the recipe
will create later. In apply mode the executor captures the itemId
before the SetField runs. Not a real blocker.

**Workflow lookup by name returns "No workflow definition matched"**

Name matching is case-insensitive against \`name\` (item name) and
\`displayName\`. Use \`workflow_inspect verb=definitions\` to enumerate.

## Verifying a push

\`\`\`bash
# Plan first
scai provision recipe push -i your-workflow.recipe.ts --what-if

# Apply (requires allowWrite on env or --allow-write flag)
scai provision recipe push -i your-workflow.recipe.ts

# Verify
scai content workflow get "Your Workflow Name"      # full definition tree
scai content workflow definitions                          # confirm it's there
\`\`\`

## Caveats

- \`bindings.templates\` accepted by schema but NOT compiled today —
  throws INPUT_INVALID. Set \`__Default workflow\` on template
  Standard Values manually until cross-recipe seeding lands.
- \`secured: true\` reserved; no security ACL emitted today.
- Per-tenant template path overrides not supported. Compiler hardcodes
  paths under \`/sitecore/templates/System/\`.

## Related

- Full reference (in-repo): \`docs/recipes/workflow.md\`
- Sitecore docs: https://doc.sitecore.com/xmc/en/developers/xm-cloud/webhooks.html
- Schemas: \`WorkflowRecipeSchema\`, \`WebhookAuthorizationRecipeSchema\` in \`src/recipe/schema/recipe.ts\`
- Compilers: \`src/recipe/compile/workflow.ts\`, \`src/recipe/compile/webhook-authorization.ts\`
- Example recipes: \`example/recipes/blog-article-approval.recipe.ts\`, \`example/recipes/ci-bearer.recipe.ts\`
`;

export const registerRecipeResources = (registry: McpRegistry): void => {
  registry.registerResource({
    uri: "scai://help/recipes-workflow",
    name: "Workflow + webhook-authorization recipe reference",
    description:
      "Reference for the `workflow` and `webhook-authorization` recipe kinds — runtime model, endpoint contract, authorization types, recipe shapes, content-tree mapping, failure modes, and troubleshooting. Read this before composing a workflow recipe or diagnosing a push failure.",
    mimeType: "text/markdown",
    handler: async () => ({
      contents: [
        {
          uri: "scai://help/recipes-workflow",
          mimeType: "text/markdown",
          text: WORKFLOW_RECIPE_REFERENCE_TEXT,
        },
      ],
    }),
  });
};
