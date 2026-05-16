---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Command tree: `setup client` consolidation and `brand` verb hoisting.**

- **`setup env` + `setup clients` → `setup client {create,list,delete}`.**
  Those two commands were the create side and the manage side of the
  same object — an environment's CM automation client — but the names
  never said so. They are now one `setup client` noun:
  `create <env>` (was `setup env <env>`), `list [env]` and
  `delete <id> [env]` (were `setup clients` / `setup clients --delete`).
  The old commands are removed — no aliases (pre-release).
- **`brand pipeline ingest|enrich` → `brand ingest` / `brand enrich`.**
  The `pipeline` parent added a word that said nothing about
  ingest-vs-enrich; the two verbs are now top-level under `brand`.
  `brand seed` still orchestrates the full happy-path flow.
