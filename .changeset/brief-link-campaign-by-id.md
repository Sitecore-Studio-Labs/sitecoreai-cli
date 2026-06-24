---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(brief): link briefs to campaigns by project UUID, not the broken project list

The brief→campaign link resolved the campaign by paging the Orchestrate project list and matching `story:`/`handle:` labels (`findProjectIdByLabels`). That list endpoint caps its page size with a non-advancing cursor (same family as the brief list), so once a tenant has more projects than one page, the campaign sits past page 1, is never found, and the link silently never lands — the campaign's `project.briefs[]` reverse view stays empty.

The brief-instance recipe now accepts an optional `campaignSitecoreId` (the linked campaign's Orchestrate project UUID). When present, `resolveCampaignTarget` links straight to it (`getProject(id)` + `PATCH /links`) and skips the label search entirely. The orchestrator forwards the campaign's stamped `sitecoreId`; CLI / older callers without it fall back to the label search. Additive + back-compatible — the schema strips the field for older binaries.
