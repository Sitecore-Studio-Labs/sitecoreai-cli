---
name: access-and-policy
description: Navigate scai's access model — the workspace policy allowlist and the credential/keychain patterns. Use when a command fails with POLICY_DENIED or AUTH_REQUIRED, when authenticating an environment, or to pick the fastest route to gain access to an environment.
---

# Access & Policy

Two gates stand between a command and a Sitecore environment: the
**workspace policy allowlist** and a **credential**. This skill maps each
failure to the one command that clears it — so you ask the operator for
the right access _once_, instead of discovering the gates one
round-trip at a time.

## Step 0 — always start with `scai setup status`

It lists every configured environment and, per environment: `cmAuth`,
`deployToken`, and `credentials` (`env client` / `org client` /
`brand`). Read it before guessing — it names which gate is closed.

## Gate 1 — the workspace policy allowlist

`~/.sitecoreai/policy.json` is a **deny-by-default** allowlist of the
environments scai may operate against.

- **File absent** → _unmanaged mode_: the gate is a no-op; every
  configured environment is usable.
- **File present** → _managed mode_: only enrolled environments work.

| Symptom                                                   | Fix                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POLICY_DENIED` — "not in the workspace policy allowlist" | `scai policy allow <env>`                                                       |
| `POLICY_DENIED` — "identity has changed since enrolled"   | `scai policy trust <env>` — **only** if the org/project/env/host change is real |
| See what's allowed                                        | `scai policy show`                                                              |
| No policy file yet, want one                              | `scai policy init`                                                              |
| Tune ceiling / CI-writes / mint eligibility               | `scai policy set <env>`                                                         |

Enrollment **pins the tenant identity** (org / project / environment /
host). If the profile's identity later drifts, the gate fails closed —
that is a tamper signal, not a bug.

## Gate 2 — credentials

### Where credentials live

- **Config (`sitecoreai.cli.json`)** holds only _non-secret metadata_ —
  ids, host, the `automationClient` block's `clientId` / `name`.
- **Secrets live in the OS keychain**, keyed by the **literal env
  name**: `deploy:<env>`, `cm-client:<env>`, `org-client:<orgId>`.

### `ref` shares config, not secrets

A profile with `"ref": "<other-env>"` inherits the other env's _config
fields_ — but **not** its keychain secrets. A `ref`'d environment still
needs its own credential. (`setup status` shows `cmAuth: missing` even
though the inherited `automationClient` metadata looks present.)

### The three credential kinds

| Kind          | Keychain slot        | Minted by                        | Lifetime / scope                   |
| ------------- | -------------------- | -------------------------------- | ---------------------------------- |
| Deploy token  | `deploy:<env>`       | `scai setup login` (device flow) | ~24h; Deploy API + CM/admin scopes |
| Env CM client | `cm-client:<env>`    | `scai setup client create <env>` | long-lived; one environment        |
| Org client    | `org-client:<orgId>` | `scai setup client create --org` | long-lived; every env in the org   |

## The two gotchas that cost the most time

1. **Device login needs a TTY.** `scai setup login` is an interactive
   browser device flow — it hard-fails (`Non-interactive mode: this
command requires input`) when stdin/stdout is not a TTY. An automated
   agent's shell is **not** a TTY, so an agent **cannot trigger device
   login** — it must ask the human to run it in a real terminal, or use
   the non-interactive client-credentials path below.

2. **Minting needs a token to bootstrap.** `scai setup client create`
   calls the Deploy API, which needs a deploy token _for that env_ — but
   a brand-new env has none (chicken-and-egg). Resolve it with either: a
   human device login first (which gives the env its own token), or
   `SITECOREAI_DEPLOY_TOKEN=<token>` for the single mint call. Reusing
   another env's token is fine _within one org_, but **get the
   operator's explicit say-so first** — cross-env credential reuse is
   otherwise refused.

## Non-interactive authentication

When no human / TTY is available, use client credentials — no device
login, no token reuse:

```
SITECOREAI_CLIENT_ID=<id> SITECOREAI_CLIENT_SECRET=<secret> \
  scai <command> -n <env>
```

or set `useClientCredentials: true` + `clientId` on the profile and
supply `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`.

## Decision tree — "how do I gain access to environment X?"

1. `scai setup status` — read X's row.
2. Not in `sitecoreai.cli.json`? → `scai setup init -n X` (or add the
   profile), then continue.
3. `POLICY_DENIED`? → `scai policy allow X` (or `scai policy trust X` on
   a legitimate identity change).
4. `cmAuth: missing` / `deployToken: missing`?
   - Human at a terminal → `scai setup login -n X`.
   - Want a long-lived credential → `scai setup client create X` (env)
     or `--org` (whole org).
   - No human, CI-style → client credentials (above).
5. Request the **minimum ceiling** you need — `read` for inspection;
   only ask for `write` when a command actually mutates.

## When you ask the operator for access

State all four in one message — it collapses the round-trips: the
**environment name**, the **gate** that is closed (policy vs
credential), the **exact command** that clears it, and **who must run
it** (you, or the human, and why).

## Related skills

- `environment-setup` — first-time environment + auth configuration.
- `deploy-ops` — Deploy API operations once access is established.
- `troubleshooting` — broader error diagnosis.
