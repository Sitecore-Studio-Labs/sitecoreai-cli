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

## Phase 2 — caller context and tier gating

Phase 1 answered _which environments_. Phase 2 answers _who is calling, and
what may they do there_ — it makes the stored `ceiling` enforce, gates
credential minting, and governs CI writes per environment.

### The reframe: caller context, not token provenance

The Phase 1 plan said "tag tokens with provenance (`interactive-human` /
`m2m` / `ci`)". Mapping the code showed that to be the wrong primitive. A
token is acquired once and reused for weeks; a token minted by a human at a
laptop is later replayed by an unattended cron. The token's _birth_ says
`interactive-human` while the _caller_ is a machine. Stored token provenance
answers "how was this token born", not "who is invoking right now" — and the
latter is what a guardrail needs.

So Phase 2 computes **caller context per invocation**, from the process
environment — no token metadata, no keychain changes, and no chokepoint
problem (token acquisition is scattered across many call sites; the process
environment is one thing, readable anywhere).

| Caller context      | Detected from                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `mcp`               | `SITECOREAI_MCP_SERVE` is set — the process is a `scai mcp serve`                           |
| `ci`                | a CI env var is set (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, …); a pipeline id where available |
| `interactive-human` | stdin+stdout are TTYs and `SITECOREAI_NON_INTERACTIVE` is not set                           |
| `m2m`               | none of the above — a script, daemon, or SDK embed                                          |

First match wins, in that order.

### Policy additions

`PolicyEnvironment` gains two booleans (both default `false`, both
narrowable — never widenable — by a repo policy):

- `mintCredentials` — may `scai setup client create` mint an automation
  client for this environment. `scai setup login` enrolls a _new_
  environment with this `true` (the operator is present and minting is the
  expected next step); `mcp serve` and `policy allow` enroll with it `false`.
- `ciWrites` — may a `ci` caller perform `write` / `destructive` operations
  here. Always defaults `false`; enabling it is a deliberate operator act.

### Risk tiers and the gate

`authorizeOperation({ envName, configRootDir, tier })` — `tier` is one of
`read | write | destructive | mint`. A no-op in unmanaged mode. Otherwise:

| tier          | rule                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`        | allowed                                                                                                                                             |
| `write`       | env ceiling ≥ `write`; a `ci` caller needs `ciWrites`; `interactive-human` / `m2m` / `mcp` allowed (MCP writes stay governed by `denyMcpElevation`) |
| `destructive` | env ceiling ≥ `destructive`; `interactive-human` allowed; `ci` needs `ciWrites`; `m2m` / `mcp` denied                                               |
| `mint`        | env `mintCredentials` is `true` **and** caller is `interactive-human` — `ci` / `m2m` / `mcp` can never mint                                         |

`mint` is gated by the `mintCredentials` flag, not by the ceiling ordering —
minting a standing credential is categorically different from an in-tenant
write.

### What Phase 2 wires

- **`write`** — folded into `ensureAllowWrite` (`src/shared/allow-write.ts`),
  which every write runner already calls. The policy check runs
  unconditionally; `--allow-write` still bypasses the _config_ `allowWrite`
  requirement but **not** the policy ceiling / caller check.
- **`mint`** — `scai setup client create` (env- and org-scoped) calls the
  `mint` gate before minting. This closes the original "credential creation
  is too powerful" concern: an agent or CI run can never mint a client —
  only a human at a terminal, on an environment the policy marks
  mint-eligible.
- **`destructive`** — the tier and its rule exist in `authorizeOperation`,
  but wiring each destructive operation to call it is **Phase 3** (it belongs
  with the operation risk registry). Phase 2 does not change the behaviour of
  publish / unpublish / recipe push / env delete.

### Command surface

`scai policy set <env> [--ceiling <tier>] [--ci-writes | --no-ci-writes]
[--allow-mint | --no-mint]` — the deliberate-act surface for tuning an
enrolled environment. `scai policy show` displays `ceiling`,
`mintCredentials`, and `ciWrites` per environment.

### Not in Phase 2

- True step-up (re-proving identity with a _fresh_ token within N minutes) —
  caller context already proves a human is present _now_ via the TTY; a
  freshness requirement is a Phase 3 refinement.
- Replacing every scattered ad-hoc TTY check with `resolveCallerContext` —
  Phase 2 adds the helper and uses it in the new gates only.
- A minted-client scope ceiling — the Deploy clients API assigns scopes
  server-side by client type; clamping them needs API support.

## Phase 3 — operation risk registry, destructive-tier wiring, step-up

Phase 2 built the `destructive` tier rule into `authorizeOperation` but left
it unwired — no operation declared itself destructive. Phase 3 classifies the
mutating operations, wires the irreversible ones to the `destructive` tier,
and adds a per-environment freshness ("step-up") requirement.

### Operation risk registry

`src/policy/operations.ts` is the single, auditable classification of
mutating operations. It maps a stable `OperationId` to a `RiskTier`:

```ts
export const OPERATION_RISK: Record<OperationId, RiskTier> = {
  "cleanup-versions-prune": "destructive",
  "cleanup-archive-purge": "destructive",
  "cleanup-dead-templates": "destructive",
  "cleanup-duplicates": "destructive",
  "cleanup-subtree": "destructive",
  "cleanup-roles": "destructive",
  "cleanup-users": "destructive",
  "cleanup-site-residue": "destructive",
  "recipe-push": "destructive",
  "deploy-environment-delete": "destructive",
  "deploy-project-delete": "destructive",
};
```

Anything not listed is `write`. A security reviewer reads this one file to
see everything scai treats as irreversible — the registry, not a literal
scattered across runners, is the source of truth.

### Wiring: one parameter, no new chokepoint

`ensureAllowWrite` — which every write runner already calls, and which Phase
2 made consult the policy — gains an optional `operation` argument. When
given, the gate looks the operation up in the registry and authorizes at that
tier instead of the default `write`:

```ts
ensureAllowWrite(root, envName, override, "cleanup-versions-prune");
```

A destructive runner passes its operation id; everything else is unchanged.
Operations that already had a gate keep it — Phase 3 layers the policy tier
on top, it does not remove `--apply` or `confirmDestructive`. The gate stays
a no-op in unmanaged mode.

The net effect: an irreversible operation is refused for a `m2m` or `mcp`
caller, and for a `ci` caller without `ciWrites`, on a managed environment —
exactly the `destructive` rule from Phase 2.

### Step-up — a freshness requirement

`PolicyEnvironment` gains an optional `stepUpMinutes`. When set, a
`destructive` or `mint` operation on that environment requires the deploy
token to have been minted within that many minutes — otherwise the gate
refuses with `POLICY_DENIED` and an instruction to re-run `scai setup login`.

This is a _pre-flight_ check, not a mid-command browser pop: scai commands
are one-shot, so step-up cannot pause and resume. The check reads
`deployTokenLastUpdated` (the freshness metadata already on the env profile).
It is **off by default** — `stepUpMinutes` unset means no freshness
requirement; an operator opts a sensitive environment in. A repo policy may
only _shorten_ the window, never lengthen it.

`scai policy set <env> --step-up <minutes>` (and `--step-up off`) configures
it; `scai policy show` displays it.

### What Phase 3 does not change

- Operations not in the registry stay `write`-tier — their existing
  `--apply` / `confirmDestructive` gates are untouched.
- Recipe execution still runs `.recipe.ts` as in-process code — see Phase 4.

## Phase 4 — recipe execution sandboxing

`.recipe.ts` files are compiled and `require()`d to load them. Phase 4 moves
that out of scai's process into a confined child, so a hostile recipe a
weaponized config could point at can no longer run with scai's privileges.
This is a workstream distinct from the authorization model — see
[recipe-sandbox.md](recipe-sandbox.md).
