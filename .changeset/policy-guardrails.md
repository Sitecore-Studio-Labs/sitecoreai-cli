---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Workspace policy guardrails — scai now operates against a deny-by-default allowlist of environments (Phase 1).**

`sitecoreai.cli.json` was both the target list _and_ the permission
grant: anyone who could write that file could add a production
environment and grant `allowWrite` to it in one edit. The new
**workspace policy** separates the two — an operator-owned artifact,
outside any repo, that bounds which Sitecore environments scai may touch.

- **User-global policy** (`~/.sitecoreai/policy.json`) — a deny-by-default
  allowlist of environments. The hard ceiling.
- **Repo policy** (`<repo>/scai.policy.json`, optional) — may only
  _narrow_ the user-global policy (drop environments, lower ceilings),
  never widen it. The effective verdict is the intersection of the layers.
- **Identity pinning** — each enrolled environment's tenant triple
  (`organizationId` / `projectId` / `environmentId` / `host`) is pinned at
  enrollment. If an enrolled environment name later resolves to a
  _different_ tenant, scai refuses with `POLICY_DENIED` — catching a
  config whose IDs were swapped underneath a trusted name.

Enforcement runs inside `resolveEnvironment` — the one resolver every
surface (CLI, SDK, MCP) routes through. For the MCP server this means an
agent cannot retarget a tool call at any environment the operator never
enrolled.

**Zero-config for the common case.** The environment you `scai setup
login` into, or bind a `scai mcp serve` to, is auto-enrolled — the policy
file is created and maintained by tooling, never hand-edited. Only a
_second_ environment needs a deliberate `scai policy allow`.

**No regression for existing setups.** With no `~/.sitecoreai/policy.json`
scai runs in "unmanaged mode" — enforcement is a no-op, behaviour is
unchanged. The policy file appears (and guardrails switch on) the next
time the operator runs `setup login`, `mcp serve`, or `scai policy init`.

New command group `scai policy`: `show`, `init`, `allow <env>`,
`remove <env>`, `trust <env>` (re-pin after a legitimate tenant change).
New error code `POLICY_DENIED` (exit code 3).

See `docs/policy-and-guardrails.md` for the design and threat model.
Phase 2 (credential provenance, step-up auth, mint gating) is not in this
change.
