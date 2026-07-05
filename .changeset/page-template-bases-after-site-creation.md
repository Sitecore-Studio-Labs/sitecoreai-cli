---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Page-template base templates are re-asserted after site creation, so
first installs into a fresh site collection inherit the SXA-scaffolded
`Project/<collection>/Page`.

Page templates apply at rank 0 but the site recipe (rank 5) is what
scaffolds `/sitecore/templates/Project/<collection>/Page` — on a push
that creates the collection, the early by-path resolution found nothing
and fell back to chaining the raw Foundation facets. A trailing
`__page-template-base-templates__` aggregate now re-emits each
page-template's `SetBaseTemplates` after the ranked recipe IRs: a
drift-free skip when the early pass already resolved the scaffold, a
corrective rewrite when it fell back. `pathBases` resolution also
distrusts cached nulls in the shared path-snapshot cache, since the
referenced scaffolding can be created mid-push after a miss was cached.
