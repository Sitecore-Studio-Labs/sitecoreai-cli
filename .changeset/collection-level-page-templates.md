---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Page templates now derive to a COLLECTION-level bucket (`/sitecore/templates/Project/<collection>/Pages`) instead of per-site (`…/<collection>/<site>/Pages`). The per-site placement broke idempotency in effect: the Sites API Solution template is a collection-shared singleton whose page-template references were re-pointed to the LAST pushing site's copy on every sync — so which `Page` template a newly created site scaffolded with changed push to push, and every site accumulated its own duplicate `Page`. One collection-level template (the same placement SXA's own scaffold uses) gives the Solution template a single stable target, and repeat syncs from any site in the collection converge on the same item. Existing per-site copies are left in place — the next push creates/adopts the collection-level template and new bindings point there; stale per-site copies can be cleaned up manually.
