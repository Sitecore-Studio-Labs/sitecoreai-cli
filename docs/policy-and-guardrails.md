# Environment policy & guardrails

scai's SDK, CLI, and MCP server can read and overwrite a lot. This document
describes the **workspace policy** layer that bounds _which environments scai
may operate against_ and makes the boundary tamper-evident.

This is **Phase 1**. Phases 2–3 (credential provenance, step-up auth, mint
gating, a unified `authorize()` chokepoint) are summarised at the end and are
out of scope here.

## Why

The weakness Phase 1 closes: **`sitecoreai.cli.json` is both the target list
and the permission grant.** `EnvironmentConfiguration` carries the tenant
identity _and_ `allowWrite` / `denyMcpElevation` in the same object, and
`resolveRootConfigurationPath` trusts any `sitecoreai.cli.json` it finds.
Anyone who can write that file can both add a production environment and
grant themselves write to it in one edit. The protections sit _beside_ the
targets, not above them.

Threat model Phase 1 addresses:

1. **Scope creep** — an agent (over MCP) or a script retargets scai at an
   environment the operator never set it up for (typically production).
2. **Identity swap** — an enrolled environment name (`staging`) has its
   `organizationId` / `projectId` / `environmentId` quietly changed
   underneath it to point at a different tenant.

Not addressed here (see Phase 2/3): who _minted_ a credential, whether a
human is present for a destructive op, and clamping minted client scopes.

## The model in one paragraph

A **workspace policy** — an operator-owned artifact kept _outside_ the repo —
declares an **allowlist** of environments scai may target, deny-by-default.
The env config can no longer self-authorize: `allowWrite` becomes a _request_
the policy must already have granted. The common case stays zero-config: the
environment you `scai setup login` into, or bind a `scai mcp serve` to, is
auto-enrolled. Only a _second_ environment needs a deliberate act.

## Artifacts

| Artifact                 | Location                                                 | Role                                                                                             |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| User-global policy       | `~/.sitecoreai/policy.json`                              | The hard ceiling. Operator-owned, outside any repo. The allowlist + pinned identities live here. |
| Repo policy _(optional)_ | `<repo>/scai.policy.json`, next to `sitecoreai.cli.json` | May only **narrow** the user-global policy — drop environments, lower ceilings. Never widens.    |

`~/.sitecoreai/` is already an established directory (`audit.log`,
`rollback/`). The policy file joins it. The repo policy is committable so a
team can ship a narrower-than-personal default; because it can only narrow,
it is safe to apply without a trust ceremony.

## Policy schema

User-global `~/.sitecoreai/policy.json`:

```json
{
  "version": 1,
  "environments": {
    "staging": {
      "identity": {
        "organizationId": "org_AbC",
        "projectId": "prj_DeF",
        "environmentId": "env_GhI",
        "host": "xmc-acme-staging.sitecorecloud.io"
      },
      "ceiling": "write",
      "enrolledAt": "2026-05-17T12:00:00.000Z",
      "enrolledVia": "setup-login"
    }
  }
}
```

- `identity` — the pinned tenant triple + host, captured at enrollment. Each
  field is individually optional (an org-level profile has no
  `projectId` / `environmentId`); enforcement compares only the fields the
  policy actually pinned.
- `ceiling` — `read` \| `write` \| `destructive` \| `mint`. **Phase 1 records
  it but enforces only enrollment + identity.** Ceiling enforcement (and the
  `destructive` / `mint` tiers) arrives in Phase 2.
- `enrolledVia` — `setup-login` \| `mcp-serve` \| `policy-allow` \|
  `setup-init` \| `policy-init`. Provenance of the enrollment, for `policy show`.

Repo `scai.policy.json` (every field optional, narrowing-only):

```json
{
  "version": 1,
  "allowEnvironments": ["staging"],
  "environments": { "staging": { "ceiling": "read" } }
}
```

- `allowEnvironments` — when present, the effective allowlist is the
  _intersection_ with the user-global allowlist. The repo can remove
  environments, never add.
- `environments.<name>.ceiling` — may only **lower** the user-global ceiling.

## Risk tiers

`read < write < destructive < mint`. Phase 1 wires the type and stores a
ceiling per environment; it does **not** yet gate operations by tier — that
is Phase 2, where the existing publishing consent model generalises to the
`destructive` tier and minting (`scai setup client create`) becomes `mint`.

## Layered resolution

`resolveEffectivePolicy(envName, configPath)` computes, for one environment:

```
enrolled = userGlobal.has(envName)
           && (repo.allowEnvironments is absent || repo.allowEnvironments.has(envName))
ceiling  = min(userGlobal.ceiling, repo.ceiling ?? userGlobal.ceiling)
identity = userGlobal.environments[envName].identity
```

Effective permission is always the **intersection** of the layers — never the
union. A missing user-global policy means _unmanaged mode_ (see below).

## Identity pinning (the Phase 1 TOFU)

Trust-on-first-use here is the **environment identity pin**. When an
environment is enrolled, its tenant triple + host are copied into the policy.
On every later `resolveEnvironment`, the config's current triple for that
environment is compared against the pinned one. A mismatch — `staging` now
resolving to a different `environmentId` — is refused with `POLICY_DENIED`
and an instruction to re-pin via `scai policy trust <env>` once the change is
confirmed legitimate. The allowlist catches _new_ environments; the identity
pin catches _swapped_ ones.

(The repo policy can only narrow, so it carries no fingerprint ceremony in
Phase 1. If a future repo policy gains widening-capable fields, it gets one.)

## Enforcement point

Enforcement lives **inside `resolveEnvironment()`** (`src/shared/env.ts`) —
the single resolver every surface (CLI, SDK, MCP) already routes through, so
no call site can miss it. After the environment is resolved it calls
`enforceEnvironmentPolicy(envName, environment, configPath)`, which throws
`POLICY_DENIED` on a non-enrolled or identity-drifted environment.

`ResolveEnvironmentOptions` gains `skipPolicy?: boolean`. The `setup` and
`policy` command families pass it — they must run _before_ enrollment exists
and must be able to report on environments that are not enrolled. Everything
that touches tenant data runs enforced.

For the MCP server: startup (`resolveMcpEnv`) resolves with `skipPolicy` then
enrolls the bound environment; per-tool retargeting (`resolveEnvBinding`)
resolves _enforced_, so an agent cannot retarget a tool call at an
environment the operator never enrolled.

## Auto-enrollment & unmanaged mode

The operator never hand-edits `policy.json`. It is created and maintained by
tooling:

- `scai setup login -n <env>` — enrolls `<env>` at the `write` ceiling after a
  successful login (the operator interactively chose this environment).
- `scai mcp serve -n <env>` — enrolls the bound `<env>` at startup.
- `scai setup init` / `scai policy init` — enroll the default environment.

Enrollment is idempotent: re-running login for an already-enrolled
environment refreshes `enrolledAt` and the pinned identity, nothing else.

**Unmanaged mode:** if `~/.sitecoreai/policy.json` does not exist,
`enforceEnvironmentPolicy` is a no-op — scai behaves exactly as it did before
this feature. This is the migration path: a user who set scai up before
guardrails existed is not locked out; the policy file appears (and
enforcement switches on) the next time they run `setup login`, `mcp serve`,
or `policy init`. `scai policy show` and `scai setup status` report whether
the workspace is managed.

## `scai policy` command surface

| Command                    | Effect                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scai policy show`         | Print effective policy: managed/unmanaged, enrolled environments, ceilings, repo-policy narrowing.          |
| `scai policy init`         | Create the policy file, enrolling the default environment. For opting an existing setup in.                 |
| `scai policy allow <env>`  | Enroll `<env>` explicitly — the deliberate act for a second environment. Resolves identity from the config. |
| `scai policy remove <env>` | Un-enroll `<env>`.                                                                                          |
| `scai policy trust <env>`  | Re-pin a drifted environment's identity after the change is confirmed legitimate.                           |

All `policy` commands resolve with `skipPolicy: true` and honour the agent
contract (`--json`, `--non-interactive`).

## Module layout

```
src/policy/
  types.ts      WorkspacePolicy, RepoPolicy, PolicyEnvironment, RiskTier,
                EnvIdentity, EffectivePolicy
  schema.ts     Zod schemas + parse helpers for both policy files
  paths.ts      resolveUserPolicyPath(), resolveRepoPolicyPath(configPath)
  store.ts      sync read / atomic write of the user-global policy
  load.ts       load + validate user-global and repo policies
  identity.ts   extract an EnvIdentity from EnvironmentConfiguration; compare
  resolve.ts    resolveEffectivePolicy() — the layered intersection
  enforce.ts    enforceEnvironmentPolicy() — the deny-by-default gate
  enroll.ts     enrollEnvironment() — idempotent auto-populate
  index.ts      SDK-facing exports
src/commands/policy/
  index.ts      Commander registration
  show.ts allow.ts remove.ts trust.ts init.ts
```

`src/policy/` is a new inward domain. It imports `@/config/types` (types
only), `@/shared/errors`, and `@/shared/logger`; it does **not** import
`@/shared/env` — `resolveEnvironment` imports `policy/`, not the reverse, so
`enforce.ts` takes primitives (`envName`, `environment`, `configPath`), not
`ResolvedEnvironment`.

Validation uses **Zod** (as recipe/brand/agent schemas do) — the policy file
is a standalone artifact, not part of the AJV-validated `sitecoreai.cli.json`
schema that ships as `dist/config/*.schema.json`.

A new error code `POLICY_DENIED` is added to `src/shared/errors.ts` with its
stable exit code.

## Testing

`tests/unit/policy/` — Vitest:

- `resolve.test.ts` — layered intersection; repo narrowing.
- `enforce.test.ts` — deny-by-default; identity drift; unmanaged-mode no-op.
- `enroll.test.ts` — idempotent enrollment; identity refresh.
- `identity.test.ts` — extraction; partial-identity comparison.

Policy paths honour `SITECOREAI_POLICY_HOME` so tests run against a temp
directory and never touch the real `~/.sitecoreai/`.

## Deferred to later phases

- **Phase 2** — credential provenance (`interactive-human` / `m2m` / `ci`)
  tagged on tokens; step-up auth for `destructive`; per-environment `ciWrites`
  rule; ceiling enforcement; `mint` gating on `scai setup client create` with
  a scope ceiling; a minted-client ledger.
- **Phase 3** — a single operation risk registry and one `authorize()`
  chokepoint across CLI/SDK/MCP; recipe execution sandboxing.
