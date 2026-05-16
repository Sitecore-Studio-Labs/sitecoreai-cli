---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`hygiene cleanup publish` removed — publishing is not cleanup.**

`cleanup publish` triggered the Authoring GraphQL `publish` mutation; it
lived under `cleanup` only because it reused the CM token already in
hand. Publishing isn't a hygiene operation, and `content publish`
already covers every case:

- `content publish all` — whole-environment republish to Edge (via the
  SAI Publishing API — no Authoring path needed).
- `content publish item --site <name> --include-subitems` — a site
  subtree; `content publish item` — specific items.

The `publish` verb is also removed from the `cleanup_execute` MCP tool.
Use `content publish` / the publishing MCP tools instead.
