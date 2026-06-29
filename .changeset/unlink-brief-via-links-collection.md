---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(campaign): unlink linked briefs via the campaign API before deleting a campaign

`runCampaignDelete`'s pre-delete detach tried to clear the brief→campaign link
from the brief side (first `references`, then a probe of the brief's `links`
collection). Both were wrong: the brief↔campaign relationship is a **campaign
sub-resource**, mutated on the Orchestrate project with the **campaign**
credential — `DELETE /api/orchestrate/v1/projects/{campaignId}/briefs/{briefId}`.
So the unlink hit the wrong API with the wrong scope, the project's `briefs[]`
reverse view never dropped, and every campaign with a linked brief refused to
delete ("Failed to detach link from brief", HTTP 403).

Adds `unlinkBriefFromProject` on the campaign API and points the pre-delete
detach at it — same campaign token the delete already holds, no brief-scoped
credential, no endpoint guessing. Verified end-to-end against a live tenant: the
DELETE drops the brief from `project.briefs[]` and the campaign then deletes
cleanly.

Callers must still delete the campaign BEFORE its briefs so the briefs are alive
to be unlinked (the regenerate/prune case keeps the briefs and only drops the
campaign, where this matters most).
