---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Upgrade commander 12 → 15 and raise the runtime Node floor to 22.12.

commander 15 is fully compatible with scai's CLI surface (verified: typecheck,
build, `--help`/`--version`, and the full test suite all pass) — but it requires
**Node ≥22.12.0**. So `engines.node` moves from `>=20` to `>=22.12.0` to honestly
reflect the new floor: a commander-15 build genuinely won't run on Node 20/21.

This **drops Node 20/21 support** for consumers. All current consumers are already
clear of it (registry and orchestrator both declare Node `>=24`), and Node 20 hits
end-of-maintenance in 2026 — but it's a compat change, hence the minor bump. Pairs
with the dev-baseline move to Node 24 (`.nvmrc`/CI).
