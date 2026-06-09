---
"@sitecoreai-labs/sitecoreai-cli": patch
---

campaign: pull resolves a renamed campaign by its `handle:` label

Campaign pull located the tenant project by exact display name (or a stamped
`sitecoreId`) only — it ignored the `handle:`/`story:` identity labels the
push already stamps. So a campaign whose name drifted, or one that never got a
`sitecoreId` stamped (e.g. its first push failed), silently failed to pull:
`findProjectByName` returned nothing and the orchestrator left the recipe
unchanged. Briefs never had this problem because they pin identity with a
name-embedded marker.

- `ops campaign sync pull` gains `--handle <handle>`; when set, `readCurrent`
  builds an identity-label hint and matches the project by its `handle:` label.
- `findProjectByName` now matches by the `handle:` label ALONE (it's unique per
  campaign), or by both `story:` + `handle:` when story is also present, before
  falling back to exact-name. This mirrors how briefs match by their marker, so
  a renamed campaign resolves on pull without a stamped `sitecoreId`.
- New `campaign-pull-handle` capability token so the orchestrator only passes
  `--handle` to a binary that understands it.
