---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Brief sync: link a brief to its campaign via `PATCH /api/brief/v1/briefs/{id}/links` (system `AI`, type `project`).

Adds `linkBriefToProject()` and wires it into the brief recipe apply + schema. Orchestrate derives the campaign's `project.briefs[]` reverse view from the brief's `links` collection; the prior write targeted `references`, which left that reverse view empty.
