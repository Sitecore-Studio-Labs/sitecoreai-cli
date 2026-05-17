---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Workspace policy guardrails — destructive-tier wiring and step-up (Phase 3).**

Phase 2 built the `destructive` tier into the policy gate but left it
unwired. Phase 3 classifies scai's irreversible operations and enforces the
tier, and adds an opt-in auth-freshness requirement.

- **Operation risk registry** (`src/policy/operations.ts`) — one auditable
  file classifying mutating operations by risk tier. The eight destructive
  cleanup verbs (version prune, archive purge, dead-template / duplicate /
  subtree / role / user / site-residue removal) and `recipe push` are
  registered `destructive`.
- **Destructive-tier enforcement** — `ensureAllowWrite` takes an optional
  `operation` argument; a registered destructive operation authorizes at the
  `destructive` tier, so it is refused for `m2m` / `mcp` callers and for `ci`
  callers without `ciWrites`. (`recipe push` previously used a stale local
  copy of the gate that predated the policy layer — now removed; it goes
  through the shared gate.)
- **Step-up** — `scai policy set <env> --step-up <minutes>` sets a
  per-environment freshness window: a `destructive` or `mint` operation then
  requires the deploy token to have been minted within it, else the gate
  refuses with a re-login instruction. Off by default; a repo policy may only
  shorten the window. `scai policy show` displays it.

Unmanaged mode remains a full no-op. Deploy environment/project deletion is
not policy-tiered (those runners carry no config-env); recipe-execution
sandboxing — the `.recipe.ts` arbitrary-code concern — is tracked separately
as Phase 4. See `docs/policy-and-guardrails.md`.
