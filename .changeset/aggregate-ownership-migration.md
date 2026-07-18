---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe push: adopt + re-stamp legacy-owned shared items on the pre-aggregate → aggregate ownership migration. 0.36.1 centralised ownership of the shared enumeration templates under the synthetic `__enumeration-templates__` aggregate, but on an environment installed _before_ the aggregate existed, those `__Standard Values` items still carry the marker of whichever enum recipe compiled first (e.g. `action-placement@1`). The aggregate op saw a marker mismatch and aborted the push with `Name collision … is owned by recipe 'action-placement@1', not '__enumeration-templates__'` (exit 6). A synthetic aggregate is the stable canonical owner by construction, so it now adopts + re-stamps a twin owned by a concrete legacy recipe instead of erroring. A twin owned by a _different_ aggregate is still a genuine conflict and still errors.
