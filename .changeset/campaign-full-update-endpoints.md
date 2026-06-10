---
"@sitecoreai-labs/sitecoreai-cli": minor
---

campaign: sync field updates at EVERY level (project, deliverable, task)

scai under-discovered the Orchestrate API: it had no update path for a project
or a deliverable (only create/delete), so campaign- and deliverable-level edits
could never be pushed, and only tasks updated. Verified against the live tenant
and the Sitecore AI Symphony frontend that full-object PUTs exist at all three
levels.

- Add `updateProject` (`PUT /projects/{id}`) and `updateDeliverable`
  (`PUT .../deliverables/{id}`); `updateTask` now sends the full task object
  (incl. `id`) — a partial body was silently ignored by the API.
- The diff now emits `update` changes for project- and deliverable-level field
  drift (date-portion-aware so a bare-date vs datetime reformat isn't perpetual
  churn). `status` is excluded from the deliverable diff — deliverables have no
  status field on the wire.
- Apply converges each level via its own full-object PUT. Two critical fixes
  found via end-to-end testing: (1) adopt an existing campaign on ANY match,
  not only on rename — the old guard spawned a DUPLICATE empty project on a
  re-push without a stamped sitecoreId (the core "edits don't stick" bug);
  (2) never overwrite the in-memory project/deliverable tree with the LEAN PUT
  response, which dropped the inline children and skipped every child update.

Verified end to end against TestDemo: project description, deliverable
funnelTactics, and task dueDate all round-trip. tsc clean; 207 campaign/sync
tests pass.
