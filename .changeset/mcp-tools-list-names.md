---
"@sitecoreai-labs/sitecoreai-cli": patch
---

**`scai mcp tools list --names` — name-only listing.** The tools
inspector gained a `--names` flag that prints just the registered tool
names, one per line, with no auth class or description. Pipes and greps
cleanly. Combined with `--json` it emits `{ "tools": ["name", ...] }`.
The default TSV output (`name⇥[auth]⇥description`) is unchanged.
