---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`ops brief` / `ops campaign`: harden brief↔campaign linking and make campaign delete self-detach.

- **Linking is now observable and verified.** When a brief declares a `campaignHandle`, `ops brief` push resolves it to the campaign by its `story:`/`handle:` identity labels and PUTs the `ExternalLink` onto the brief. A failed resolution (no matching campaign) and a silent post-PUT drop used to vanish into a `warn`; both are now surfaced as a loud `error`, and the write is confirmed by re-read and retried once before giving up — so a link that didn't take is visible instead of buried.
- **`ops campaign delete` detaches its linked briefs first.** Before deleting the project it clears the campaign reference from every still-linked, still-alive brief (via the brief credential — the only side the API lets you mutate), so a campaign with a live linked brief deletes cleanly instead of failing with HTTP 403 "Failed to detach link from brief". Best-effort per brief; preserves links to other campaigns.
