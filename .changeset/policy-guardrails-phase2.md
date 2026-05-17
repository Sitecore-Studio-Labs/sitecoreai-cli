---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Workspace policy guardrails — caller context and tier gating (Phase 2).**

Phase 1 bounded _which_ environments scai may touch. Phase 2 bounds _who_ may
do _what_ there.

- **Caller context** — every invocation is classified `interactive-human` /
  `ci` / `m2m` / `mcp` from the process environment, computed fresh per call.
  This replaces the originally-planned "token provenance": a token outlives
  the session that created it, so its birth says nothing about who is
  invoking now.
- **Mint gating** — `scai setup client create` now requires an interactive
  human operator on a mint-eligible environment. An agent (MCP), a CI run, or
  any unattended process can no longer mint an automation client. `scai setup
login` marks the environment it logs into as mint-eligible, so normal
  onboarding is unaffected.
- **Write tier gating** — `ensureAllowWrite` consults the workspace policy: a
  CI caller needs the environment's `ciWrites` flag, and an environment
  capped at the `read` ceiling rejects writes. `--allow-write` still bypasses
  the config `allowWrite` requirement but never the policy.
- **`scai policy set <env>`** — tune an enrolled environment's `ceiling`,
  `ci-writes`, and `mint` eligibility. `scai policy show` now displays them.

Unmanaged mode (no `~/.sitecoreai/policy.json`) remains a full no-op, so
nothing changes for a setup that has not opted in.

The `destructive` tier is defined in the gate, but wiring each destructive
command to call it is Phase 3. See `docs/policy-and-guardrails.md`.
