---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Converge name-twins in batch-separated pushes too — fixes the batch-9 field-op aborts that survived 0.34.3 (`content-item-field:...:en:Title — Cannot find a field with the name Title`, same for new fields like `HasPanel`).

0.34.3's convergence only engaged when the planner could resolve the op's expected template to a live itemId — but in batch-separated pushes (the orchestrator's content batches) the datasource template's recipe lives in an earlier batch, so the refKey is never captured, and the planner silently fell back to the blind CreateOnly skip: the twin was adopted untouched and the follow-up field write aborted.

Eligibility is now plan-local (CreateOnly + authored fields + not folder-class) with no plan-time resolution requirement. An existing eligible item is skipped only when its template **verifiably matches**; on mismatch **or** when unverifiable, the op routes through the create mutation and the apply-time pre-check does the authoritative compare against the mutation's resolved `templateId` — adopting matching/same-shape twins untouched and replacing marker-verified childless residue as before.
