---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**MCP/CLI coherence pass — close the gaps the CLI surface cleanup
opened.** The `scai mcp serve` tool surface now tracks the CLI commands
added after the MCP server first shipped.

**New MCP tools:**

- **`recipe_sync`** — the projection of `scai sync`. A
  `{ verb }`-discriminated tool (`pull` / `status` / `push`) that fans
  pull / diff / push out over every enumerable recipe kind (brand kits
  and brief types) in one call. Previously the MCP only exposed the
  per-instance `*_recipe_*` tools, so "sync everything" had no agent
  path.
- **`explain`** — the projection of `scai hygiene explain`. A
  `{ verb }`-discriminated tool (`why-blocked` / `orphan-site`) that
  composes multiple audits into one focused answer ("what blocks this
  delete?", "what residue did this deleted site leave?"). Read-only.

**New resource:** `scai://help/topics` — the intent-based command index,
mirroring `scai cli topics`. Both surfaces now render the one shared
`TOPICS` list (`@/shared/topics`).

**Shared source of truth:**

- The cross-domain recipe-kinds list moved to `@/sync/aggregate-kinds`
  (`ENUMERABLE_RECIPE_KINDS`); `scai sync` and `recipe_sync` import the
  same list instead of hand-maintaining a copy each.
- The `TOPICS` index moved to `@/shared/topics`; the CLI command and
  the MCP resource share it.

**Help-resource refresh:** `scai://help/overview` now describes the full
tool surface (brand, briefs, campaigns, Agentic Studio, hygiene,
workflow, webhooks, publishing — not just deploy/serialization/recipe),
the complete resource + prompt lists, and accurate concurrency notes
(reads run concurrently; long writes honor cancellation + progress).
`scai://help/sitecore-apis` now maps the SAI Publishing API to the
shipped `publish_inspect` / `publish_lifecycle` tools.

**Internal consistency:** `publish_inspect` / `publish_lifecycle`
descriptions moved into `descriptions.ts` (the single audit point for
agent-facing copy). The explain hygiene tasks gained a `silent` option
so non-CLI callers get the structured report without a stdout write.

**Guardrail:** `cli-mcp-parity.test.ts` now covers the `explain` and
`recipe_sync` domains alongside workflow + webhook.
