---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Webhook event-type discovery: new CLI subcommand + MCP verb.**
Until now, agents (and humans) authoring webhooks had to guess the
right strings for `webhook create --events <name>`. Typos like
`item:saevd` only surfaced at create-time as a generic
`INPUT_INVALID: Unknown webhook event type` error. The catalog
isn't a Sitecore-published contract — it lives in the tenant's
content tree under `/sitecore/system/Settings/Webhooks/Event Types/`
and customers can extend it — so a static enum in the SDK would be
both stale and wrong for customized tenants.

This release adds a discovery surface:

**CLI:**

```sh
$ scai webhook event-types
$ scai webhook event-types --category item
$ scai webhook event-types --category publish --json
```

**MCP:** `webhook_inspect` gains a third verb:

```
{ "verb": "event-types", "category"?: "item" | "publish" }
```

Returns one entry per catalog item: `{ name, itemId, category, path }`.
Walks the Item and Publish roots; a missing root yields an empty list
rather than an error. Picks up custom event types operators have
added to their tenant.

**API:** `WebhookApiClient.listEventTypes()` is the underlying method —
useful if you're embedding scai's webhook surface in another tool.

Pair with `webhook_manage verb=create` so agents inspect-then-create
rather than guess-then-fail. Recommended discovery pattern in the
updated `webhook_inspect` tool description.
