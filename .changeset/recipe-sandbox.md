---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Recipe execution sandbox (Phase 4).**

`.recipe.ts` files were compiled and `require()`d inside scai's own process —
so loading a recipe ran arbitrary TypeScript with scai's full privileges
(filesystem, `process.env`, the OS keychain, the network). A weaponized
config that redirects the `recipes` glob could exploit that just by getting
scai to list or compile recipes.

`.recipe.ts` now loads in a confined child process:

- a **clean allowlisted environment** — no scai tokens or secrets, so a
  hostile recipe has nothing to read or exfiltrate;
- a **timeout** — a recipe that hangs is killed, not allowed to hang scai;
- **crash isolation** — a recipe that throws or calls `process.exit` no
  longer takes scai down.

Only the exported recipe — pure JSON-serialisable data, re-validated against
the Zod schema — crosses back. `.recipe.json` is unaffected (no code runs).

`SITECOREAI_RECIPE_SANDBOX=0` forces the legacy in-process load (with a
warning) for debugging. OS-level filesystem/process confinement via Node's
permission model is a noted hardening follow-up. See docs/recipe-sandbox.md.
