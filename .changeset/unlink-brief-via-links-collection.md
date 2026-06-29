---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(campaign): unlink linked briefs via the `links` collection before deleting a campaign

`runCampaignDelete`'s pre-delete detach cleared each brief's `references`
collection, but the campaign's `project.briefs[]` reverse view — what
Orchestrate's `deleteProject` checks and 403s on ("Failed to detach link from
brief") — is derived from the brief's **`links`** collection (written by
`linkBriefToProject` since the 2026-06-20 link fix). So the unlink wrote to the
wrong collection and every campaign with a linked brief refused to delete.

Adds `unlinkBriefFromProject` (DELETE `/api/brief/v1/briefs/{id}/links`, the
symmetric inverse of the add PATCH) and points the pre-delete detach at it. The
`links` collection isn't returned by `getBrief`, so the detach now issues the
unlink for every brief in the reverse view rather than diffing references.

NOTE: the DELETE-with-body endpoint shape is a best-effort guess (the remove
verb was never captured); smoke-test against a tenant. Callers must still delete
the campaign BEFORE its briefs so the briefs are alive to be unlinked.
