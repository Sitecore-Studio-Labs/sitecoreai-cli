# Workflow recipes

Reference + guide for the `workflow` and `webhook-authorization` recipe
kinds. Together they let you define an entire Sitecore workflow —
states, commands, transitions, and the webhook actions that fire as
content moves through it — as inert data committed alongside the rest
of your repo.

> **Pre-flight: do the templates exist on your tenant?** The compiler
> emits each item's `templateOf` as a content-tree path (e.g.
> `/sitecore/templates/System/Workflow/Webhook Submit Action`). The
> push pipeline resolves these against the live tenant before
> planning. If a template is missing from your XM Cloud SKU, the
> planner skips the affected op with a clear reason — never a
> server-side 500. To audit what's there now:
>
> ```bash
> scai workflow inspect "Sample Workflow"
> ```
>
> If the standard XM Cloud sample workflow's `actions` array shows
> items templated `Webhook Submit Action` / `Webhook Validation
Action`, your tenant has them. If not, strip `actions` and
> `validations` from your workflow recipe until you've installed (or
> located) the templates.

---

## How workflow webhooks work at runtime

A Sitecore workflow attaches to an item via the item's `__Workflow` and
`__Workflow state` fields. When a user (or an API call like
`scai workflow advance`) executes a workflow command, Sitecore:

1. **Resolves the target state** from the Command item's `Next state`
   field.
2. **Runs validation actions** attached to the executed Command, in
   order. Each is a synchronous HTTP POST that must return
   `{ IsValid: boolean, Message: string }`. The first one returning
   `IsValid: false` **aborts** the transition; the Message surfaces to
   the user in the CMS / API response.
3. **Updates the item's `__Workflow state` field** to the target state.
4. **Runs submit actions** attached to the new state, in order.
   These are fire-and-forget HTTP POSTs — their response is logged
   but the transition has already happened.

Where each kind attaches:

| Recipe field                     | Attaches at                                | Kind(s)                                  | Fires when                                          |
| -------------------------------- | ------------------------------------------ | ---------------------------------------- | --------------------------------------------------- |
| `state.actions[]`                | A workflow **state** (state-entry actions) | `webhook-submit` or `webhook-validation` | Item enters the state (post-transition)             |
| `state.commands[].validations[]` | A workflow **command**                     | `webhook-validation` only                | Command is invoked, before the transition completes |

State-attached actions are rarely `webhook-validation` in practice —
validating at entry rather than at the gate is unusual. The schema
accepts either kind for flexibility but the common pattern is:

- **Validations on commands** — synchronous gates ("is the title set?",
  "did the lint endpoint approve?")
- **Submit actions on states** — fire-and-forget notifications ("post
  to Slack", "kick off a publish")

---

## Endpoint contract

### Submit action (`kind: "webhook-submit"`)

```
POST <url>
Content-Type: application/json
<auth headers per the Authorization item>

{ /* payload — see below */ }
```

Sitecore does not inspect the response body. Non-2xx status is logged
to `/sitecore/system/Logging` but does **not** roll the transition
back. Use submit actions when the downstream side-effect is OK to
attempt-and-forget: notifications, async triggers, telemetry.

### Validation action (`kind: "webhook-validation"`)

```
POST <url>
Content-Type: application/json
<auth headers per the Authorization item>

{ /* payload — same shape as submit */ }

→ 200 OK
  Content-Type: application/json
  { "IsValid": true,  "Message": "" }              // proceed
  { "IsValid": false, "Message": "Title missing" } // abort transition
```

The response **must** be JSON with these exact field names
(`IsValid`, `Message` — PascalCase). Anything else — a missing field,
an HTTP error, a timeout — is treated as an abort with a generic
message. Plan endpoint code for both the happy path and the
"endpoint unavailable → safer to block" path.

### Payload shape

Sitecore POSTs a JSON body describing the workflow context. The
canonical fields (verified against Sitecore docs for 10.3+ / XM
Cloud):

```jsonc
{
  "EventName": "workflow:command:executed", // or similar identifier
  "ItemId": "{ABC...}", // Sitecore item ID, braced
  "ItemPath": "/sitecore/content/Site/Home",
  "ItemLanguage": "en",
  "ItemVersion": 3,
  "TemplateId": "{...}",
  "TemplateName": "Article",
  "WorkflowId": "{...}",
  "WorkflowName": "Editorial",
  "PreviousStateId": "{...}", // null for state-entry from no state
  "PreviousStateName": "Draft",
  "NewStateId": "{...}",
  "NewStateName": "In Review",
  "CommandId": "{...}", // null for state-entry submit actions
  "CommandName": "Submit",
  "Comments": "Looks good to me", // from the workflow command UI
  "User": { "Name": "sitecore\\admin", "Email": "..." },
  "Timestamp": "2026-05-14T12:34:56Z",
}
```

> **Verify against your tenant.** Field names + casing have shifted
> between Sitecore versions. Log the first real call your endpoint
> receives and pin schema validators in your downstream code
> accordingly. The skeleton above matches the documented Webhook
> Submit Action payload as of XM Cloud 2024+.

---

## Authorization types

Each webhook action can reference an Authorization item via the recipe's
`authorizationRef` (intra-recipe ref to a `webhook-authorization`
kind) or `authorizationPath` (absolute path to an existing tenant-
side Authorization item). Three authorization types ship with
Sitecore:

| Type                           | Recipe shape                                                                     | Wire-time behavior                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiKey`                       | `{ type, headerName, key: "$ENV:VAR" }`                                          | Adds a custom header (e.g. `Authorization: <key>` or `X-Api-Key: <key>`) on each fire. `headerName` decides the header.                                                                                                                        |
| `Basic`                        | `{ type, username, password: "$ENV:VAR" }`                                       | Adds `Authorization: Basic base64(username:password)` on each fire.                                                                                                                                                                            |
| `OAuth2ClientCredentialsGrant` | `{ type, tokenEndpoint, clientId, clientSecret: "$ENV:VAR", scope?, audience? }` | Mints a token from the configured endpoint on first fire (token-caching behavior on the Sitecore side is **undocumented** — assume per-fire fetch unless you've verified otherwise on your tenant), then sets `Authorization: Bearer <token>`. |

Secrets are **always** declared as `$ENV:VAR_NAME` references in the
recipe. The recipe file itself never carries plaintext credentials;
the push executor resolves the env var at apply time. Missing env
vars surface as a plan-phase error before any item write — you'll
never push a half-configured Authorization item.

If you don't want the recipe to manage the Authorization item, point
at one that already exists on the tenant via `authorizationPath`:

```ts
authorizationPath: "/sitecore/system/Settings/Webhooks/Authorizations/Existing CI Token";
```

---

## Authoring via recipes — full reference

### `workflow` kind

```ts
{
  kind: "workflow",
  schemaVersion: "1",
  handle: "blog-article-approval@1",    // stable; seeds every GUID via uuidv5
  name: "BlogArticleApproval",          // Sitecore item name
  displayName: "Blog Article Approval", // __Display Name field
  description?: "…",
  icon?: "Office/32x32/document_view.png",
  meta?: {
    tax?: { group?: "Editorial" }        // → /sitecore/system/Workflows/Editorial/<name>
  },
  initialState: "draft",                // must match a state.key below
  states: [
    {
      key: "draft",                      // kebab-case; seeds the state's GUID
      name: "Draft",                     // Sitecore item name
      displayName: "Draft",
      final?: false,                     // sets `Final` field (workflow terminates here)
      preview?: false,                   // sets `Preview` (item appears in preview DB)
      actions?: [                        // state-entry actions
        {
          kind: "webhook-submit" | "webhook-validation",
          key: "notify-reviewer",        // unique within the state's children
          url: "https://…",
          displayName?: "Notify Reviewer",
          description?: "Slack ping",
          serializationType?: "JSON" | "XML",  // default JSON
          enabled?: true,                      // default true
          authorizationRef?: "ci-bearer@1",    // OR
          authorizationPath?: "/sitecore/…",   // (exactly one)
        },
      ],
      commands?: [
        {
          key: "submit",
          name: "Submit",
          displayName: "Submit for Review",
          nextState: "in-review",        // must match another state.key
          autoPublish?: false,           // __Auto Publish — item auto-publishes on this transition
          suppressComment?: false,       // hide the comment prompt
          appearanceEvaluator?: "default" | "lock" | "unlock",
          secured?: false,               // restrict to admins (reserved; see Caveats)
          validations?: [                // command-level synchronous gates
            { kind: "webhook-validation", key: "lint-content", url: "…", authorizationRef: "ci-bearer@1" },
          ],
        },
      ],
    },
  ],
  bindings?: { templates: [] },          // reserved; see "Caveats" below
}
```

### `webhook-authorization` kind

```ts
{
  kind: "webhook-authorization",
  schemaVersion: "1",
  handle: "ci-bearer@1",
  name: "CI Bearer",
  displayName: "CI Bearer Token",
  description?: "Token used by CI to authenticate workflow + publish webhooks.",
  auth:
    | { type: "ApiKey", headerName: "Authorization", key: "$ENV:CI_WEBHOOK_TOKEN" }
    | { type: "Basic", username: "ci", password: "$ENV:CI_PASS" }
    | { type: "OAuth2ClientCredentialsGrant",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        clientId: "ci-bot",
        clientSecret: "$ENV:CI_OAUTH_SECRET",
        scope?: "webhook:write",
        audience?: "https://hooks.example.com" },
}
```

### Recipe → Sitecore content-tree mapping

| Recipe field                   | Sitecore path                                              | Template                                               |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| `meta.tax.group` (optional)    | `/sitecore/system/Workflows/<group>/`                      | `Workflow Folder`                                      |
| `name`                         | `/sitecore/system/Workflows/[<group>/]<name>`              | `Workflow`                                             |
| `states[].name`                | `…/<name>/<state.name>`                                    | `State`                                                |
| `states[].commands[].name`     | `…/<name>/<state.name>/<cmd.name>`                         | `Command`                                              |
| `states[].actions[].key`       | `…/<name>/<state.name>/<action.key>`                       | `Webhook Submit Action` or `Webhook Validation Action` |
| `commands[].validations[].key` | `…/<name>/<state.name>/<cmd.name>/<val.key>`               | `Webhook Validation Action`                            |
| Webhook authorization          | `/sitecore/system/Settings/Webhooks/Authorizations/<name>` | `Api Key`/`Basic`/`OAuth2 Client Credentials Grant`    |

State/command/action children all live as **direct** children of their
parent in the content tree — there is no `Actions/` subfolder.
Naming collisions within a state (e.g. an action and a command sharing
a name) would conflict, so `key` and `name` should be unique among
siblings.

---

## Failure modes + retry

| Scenario                                                                | What happens                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation endpoint returns `IsValid: false`                            | Transition aborts. `Message` surfaces in the CMS error UI / API response. The item stays in its current state.                                                                      |
| Validation endpoint returns non-JSON, HTTP 4xx/5xx, or times out        | Same — transition aborts. Sitecore treats unknown response as "blocked, safer to fail closed." Default timeout is **15 seconds** (Sitecore-side; not configurable from the recipe). |
| Submit endpoint returns non-2xx                                         | Logged to `/sitecore/system/Logging`. Transition is already complete — no rollback.                                                                                                 |
| Submit endpoint times out                                               | Same — log + continue. **No retries** by default.                                                                                                                                   |
| Authorization item references an `$ENV:VAR` that's missing at push time | Recipe push fails at plan phase with a clear error. No item write happens.                                                                                                          |
| Authorization item is deleted from the tenant after the action is bound | Action fires without auth headers. The endpoint will reject; the failure is silent for submit actions and a transition-block for validations.                                       |

There is no built-in retry queue. If you need at-least-once delivery
for submit actions, set up an idempotent receiver and a separate
reconciliation pipeline — don't lean on Sitecore retries.

---

## Troubleshooting

**`templateOf path '/sitecore/templates/System/Workflow/Webhook Submit Action' did not resolve`** during a dry-run

The webhook-action templates aren't present at that path on your
tenant. Most likely causes:

- Older XM Cloud SKU that pre-dates the webhook-actions templates.
  Verify by running `scai workflow inspect "Sample Workflow"` — if
  Sample Workflow's actions are templated `Webhook Submit Action`, the
  templates exist somewhere else; check `/sitecore/templates/System/`
  via the CMS for the actual path and PR an update to
  `src/recipe/compile/workflow.ts`'s `TEMPLATE_PATHS` constant.
- Tenant-customized template tree. Use `authorizationPath` /
  custom-templated workflows on this tenant; the recipe model
  doesn't currently support per-tenant template path overrides
  (tracked as a follow-up).

**Validation action always blocks the transition**

Check the endpoint response:

```bash
curl -X POST <url> -H "Content-Type: application/json" -d '{"…":"…"}'
```

The body must be JSON with `IsValid: true` / `IsValid: false` —
exact PascalCase field name. Sitecore treats anything else as
"unknown → safer to block."

**Submit action fires twice**

Almost certainly an upstream pattern (e.g. ISR + Sitecore both
trigger from the same event). Sitecore itself doesn't retry submit
actions.

**`scai recipe push --what-if` shows
`Target item (refKey …) not yet captured/created` on a SetField op**

Plan-mode-only artifact. In `--what-if`, the executor doesn't actually
run any CreateItems, so a downstream SetField targeting a not-yet-
created item shows as `skip`. In apply mode the executor captures the
itemId after CreateItem and resolves the SetField fine. Not a real
blocker.

**`scai workflow inspect "Workflow Name"` returns "No workflow
definition matched"**

Name matching is case-insensitive against both `name` (Sitecore item
name) and `displayName` (`__Display Name` field). If both are empty
or you have multiple workflows sharing a name, fall back to a path
or GUID. Use `scai workflow list-defs --json` to enumerate.

---

## Walkthrough — `blog-article-approval@1`

The shipped [example recipes](../../example/recipes/) build an editorial
workflow with three states, four transitions, three webhook actions, and
one shared authorization:

```
Draft ──submit──▶ In Review ──approve──▶ Approved (final)
                       └──reject──▶ Draft
```

| Step | Op                                         | Result on the tenant                                                   |
| ---- | ------------------------------------------ | ---------------------------------------------------------------------- |
| 1    | `CreateItem` Editorial folder (CreateOnly) | `/sitecore/system/Workflows/Editorial` (skipped on re-push)            |
| 2    | `CreateItem` workflow                      | `/sitecore/system/Workflows/Editorial/BlogArticleApproval`             |
| 3    | `CreateItem` × 3 state items               | Draft, InReview, Approved                                              |
| 4    | `SetField` `__Initial state`               | Workflow points at Draft as the entry state                            |
| 5    | `CreateItem` × 3 commands                  | Submit (Draft), Approve + Reject (InReview)                            |
| 6    | `CreateItem` × 1 validation                | `lint-content` under the Approve command                               |
| 7    | `CreateItem` × 2 submit actions            | `notify-reviewer` (InReview state), `publish-trigger` (Approved state) |

Re-pushing the same recipe is a no-op: every GUID is `uuidv5(handle)`-
derived, the policy is `CreateAndUpdate`, and per-field diff means only
authored field changes get written.

To deploy:

```bash
scai recipe push \
    -i example/recipes/ci-bearer.recipe.ts \
    -i example/recipes/blog-article-approval.recipe.ts \
    --what-if   # plan first
```

Then verify:

```bash
scai workflow inspect "Blog Article Approval"   # full definition tree
scai workflow list-defs --json                  # confirm it shows up
scai workflow advance /sitecore/content/MySite/AnArticle \
    --command "Submit for Review" --what-if    # smoke-test a transition
```

---

## Caveats (current scope)

- **`bindings.templates`** is accepted by the schema but **not yet
  compiled.** It would, when shipped, set `__Default workflow` on each
  bound template's Standard Values. Today, set that field manually in
  the CMS or via a separate `SetField` recipe op until cross-recipe
  seeding for external Standard-Values paths lands.
- **`secured: true` on commands** is reserved. Will eventually emit an
  ACL on the command's `__Security` field; today the field is silent.
- **Per-tenant template path overrides** are not configurable. The
  compiler hardcodes the paths under `/sitecore/templates/System/`.
  When a tenant has customized this, the planner skips with a clear
  reason and you'll need to PR the path constant in
  `src/recipe/compile/workflow.ts`.
- **OAuth2 token caching** on the Sitecore side is undocumented and
  varies by version. If your token endpoint is rate-limited, expect to
  cache server-side rather than rely on Sitecore-side caching.

---

## Cross-references

- Recipe Zod schema: [`src/recipe/schema/recipe.ts`](../../src/recipe/schema/recipe.ts)
  (`WorkflowRecipeSchema`, `WebhookAuthorizationRecipeSchema`)
- Compiler: [`src/recipe/compile/workflow.ts`](../../src/recipe/compile/workflow.ts),
  [`src/recipe/compile/webhook-authorization.ts`](../../src/recipe/compile/webhook-authorization.ts)
- GUID derivation: [`src/recipe/guids.ts`](../../src/recipe/guids.ts)
  (`workflowId`, `workflowStateId`, `workflowCommandId`, `webhookAuthorizationId`)
- Example recipes: [`example/recipes/blog-article-approval.recipe.ts`](../../example/recipes/blog-article-approval.recipe.ts),
  [`example/recipes/ci-bearer.recipe.ts`](../../example/recipes/ci-bearer.recipe.ts)
- Sitecore documentation (authoritative on payload + field names):
  - [Webhooks overview](https://doc.sitecore.com/xmc/en/developers/xm-cloud/webhooks.html)
  - [Webhook Submit Action fields](https://doc.sitecore.com/xmc/en/developers/xm-cloud/webhook-submit-action-configuration-fields.html)
  - [Webhook Validation Action fields](https://doc.sitecore.com/xmc/en/developers/xm-cloud/webhook-validation-action-configuration-fields.html)
  - [Authorizations](https://doc.sitecore.com/xmc/en/developers/xm-cloud/webhook-event-handler-configuration-fields.html#authorization)
