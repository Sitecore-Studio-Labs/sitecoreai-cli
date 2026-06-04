---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`brief delete`: clear `brief.references[]` before issuing the DELETE.

`runBriefDelete` now PUTs `{references: []}` against the brief immediately before calling `deleteBrief`. The Orchestrate `deleteProject` reverse-view machinery tries to detach `project.briefs[]` entries before completing — and 403s when those briefs have already been deleted without first clearing their references. Doing the unlink at the source (brief side) gives Orchestrate's reverse view a chance to clean up while the brief is still alive, eliminating the dangling-reference state that the project-delete path can't recover from.

Best-effort: a failure on the unlink step is logged but does not block the delete (the brief still ends up gone — that's the caller's goal; only the downstream project might carry a dangling ref, which is no worse than the prior behaviour). Verified empirically 2026-06-04 that PUT-ing an empty `references` array on a brief with no references is a clean no-op, so the unlink step is safe to apply unconditionally.

Consumers: the showcase-orchestrater's `brand-delete-mode` (and `story-delete-mode`) cascade now drives this fix automatically — no orchestrator-side changes required to pick it up.
