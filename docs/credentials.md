# scai credential model

scai authenticates to Sitecore Cloud with exactly **two kinds of
credential**, plus short-lived tokens derived from them. This document is
the single source of truth — every representation listed at the bottom
must agree with it.

## The storage principle

**The config file (`sitecoreai.cli.json`) holds every credential's
non-secret metadata — a readable inventory of what's configured; the OS
keychain holds only secrets.**

So for each credential the config carries the `clientId` and any
identifying metadata (display name, mint timestamp, token-freshness
timings), and the keychain carries exactly one thing: the secret. This is
uniform across all three credential records — the env-scoped automation
client (`automationClient` on the env profile), the org-scoped automation
client (`orgClients[orgId]`), and the brand key (`brand[orgId]`).

## The two credentials

### 1. Automation client

An OAuth machine-to-machine client (`clientId` + `clientSecret`) that scai
**mints** via the XM Cloud Deploy clients API. It is **one concept**,
provisioned at two **scopes**:

| Scope        | Deploy client type | Bound to                    | Minted by                              | Config metadata                      | Keychain slot (secret only) |
| ------------ | ------------------ | --------------------------- | -------------------------------------- | ------------------------------------ | --------------------------- |
| Environment  | `cm`               | org + project + environment | `scai setup client create <env>`       | `envProfiles.<env>.automationClient` | `cm-client:<env>`           |
| Organization | `deploy`           | org only                    | `scai setup client create --org <env>` | `orgClients[orgId]`                  | `org-client:<orgId>`        |

Both are the _same kind of thing_ — an automation client — differing only
in scope. Their non-secret metadata (`{ clientId, name, mintedAt }`) lives
in the config block above; only the `clientSecret` lives in the keychain
slot. "deploy" and "cm" are **not** separate credentials; they are this
one client at org vs. env scope.

**Used by:** Deploy API, Authoring / Management GraphQL (serialization,
recipes, hygiene), Publishing, Sites, Pages, Brief. **Not** Campaign — the
Orchestrate (Campaign) API is an AI API and uses the brand / AI APIs key
below (verified 2026-05-16). An env profile that has a project +
environment uses its **env-scoped** client; an org-level profile (no
project/environment of its own — e.g. `agents`) uses the **org-scoped**
client.

### 2. Brand / AI APIs key

An OAuth client for the Sitecore AI APIs. **Not minted by scai** — the
operator creates it in Cloud Portal → Stream → Admin → AI APIs keys, then
**registers** it into scai. Org-scoped, one per org.

| Aspect        | Value                                                                         |
| ------------- | ----------------------------------------------------------------------------- |
| Registered by | `scai setup client …` (brand verb — unified under `setup client`)             |
| Keychain slot | `ai-skills-secret:<orgId>` (the secret)                                       |
| Config        | `brand[orgId]` block — `clientId`, `authority`, `audience` (never the secret) |

**Used by:** `scai brand` **and** `scai ops campaign` — the Orchestrate
(Campaign) API is an AI API and authenticates with this key, not the
automation client (verified 2026-05-16: a token minted from the AI APIs
key calls `/api/orchestrate/v1/projects`; a `cm`/`deploy` automation
client gets `403 Insufficient scope`). The automation client cannot do
brand/campaign work and vice versa — hence two credentials.

## Tokens are not credentials

Every API call uses a short-lived access **token** minted from one of the
two credentials above. The token strings themselves are keychain-cached
(`deploy:`, `cm:`, `brief:`, `campaign:`, `publishing:`, `ai-skills-token:`
slots) with their own expiry. A token's **freshness metadata** — when it
was minted and how long it lives — is non-secret, so it follows the
storage principle and lives in the config file: the deploy token's
`deployTokenExpiresIn` / `deployTokenLastUpdated` on the env profile, the
brand token's `tokenExpiresIn` / `tokenLastUpdated` in `brand[orgId]`.

## Bootstrap

Minting the first automation client needs a deploy token. `scai setup
login` does a one-time interactive device login for that token; it is used
only to call the clients API and mint the automation client(s). After the
automation client exists it is self-sufficient — every later token is
minted from it.

## What the config carries

An env profile (`EnvironmentConfiguration`) carries **environment
identity** — `organizationId`, `projectId`, `environmentId`, `host`,
`authority`, `audience`, `environmentType` — **plus the non-secret
metadata of the credentials and tokens configured for it**. It does
**not** carry secrets. There is **no `clientSecret` field** on the env
profile.

Concretely the config holds:

- `automationClient` on the env profile — the scai-minted env-scoped
  client's `clientId` / `name` / `mintedAt`. Secret in `cm-client:<env>`.
- `orgClients[orgId]` at the config root — the scai-minted org-scoped
  client's `clientId` / `name` / `mintedAt`. Secret in `org-client:<orgId>`.
- `brand[orgId]` — the brand key's `clientId` / `authority` / `audience`
  and token-freshness timings. Secret in `ai-skills-secret:<orgId>`.
- `deployTokenExpiresIn` / `deployTokenLastUpdated` on the env profile —
  the cached deploy token's freshness metadata.

`clientId` + `useClientCredentials` remain as the bring-your-own-client
escape hatch (operator supplies their own automation client `clientId`;
the matching secret is supplied via `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`
and resolved at the auth layer — it is never written to the config).

## Auth resolution (per API call)

The shared resolver `resolveClientCredential` (`src/shared/client-credential.ts`)
resolves a `{ clientId, clientSecret }` pair in order. The `clientId`
always comes from the config; the matching secret from the keychain:

1. `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` (or the global
   `SITECOREAI_CLIENT_SECRET`) — read by `resolveEnvClientSecret`, paired
   with the env profile's `clientId` (bring-your-own-client).
2. env-scoped automation client — `clientId` from the env profile's
   `automationClient` block, secret from `getCmClientSecret(envName)`.
3. org-scoped automation client — `clientId` from `orgClients[orgId]`,
   secret from `getOrgClientSecret(orgId)`.

`client-credential.ts` is a leaf module and never imports `config/`; the
caller reads the `clientId`s from the resolved config and passes them in
(`automationClientId` / `orgClientId`). `acquireBriefToken`,
`acquireCampaignToken`, and the CM / serialization client-credentials path
(`acquireAccessToken` → `requestClientCredentialsToken`) all resolve the
secret this way before the OAuth call. Brand uses its own org key
(`getBrandClientSecret(orgId)`), not this chain.

## Migration notes (for the consistency sweep)

- `clientSecret` on the env profile is **removed** — no back-compat. The
  bring-your-own-client secret is supplied via
  `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` and resolved at the auth layer
  (`resolveEnvClientSecret`). A stale `clientSecret` left in a legacy
  config is scrubbed on the next config write; the schema's
  `additionalProperties: false` rule means a legacy config still carrying
  it is rejected as `CONFIG_INVALID` until repaired (`scai setup init`).
- The scai-minted automation client is split per the storage principle:
  its non-secret metadata (`clientId` / `name` / `mintedAt`) lives in the
  config (`automationClient` / `orgClients[orgId]`); only the secret lives
  in the keychain (`cm-client:<env>` / `org-client:<orgId>`). The keychain
  no longer stores the whole `{ clientId, clientSecret, name, mintedAt }`
  bundle.
- `deployTokenExpiresIn` / `deployTokenLastUpdated` live **on the env
  profile** in the config — freshness metadata is non-secret, so it
  follows the storage principle. `isDeployTokenExpired` reads those config
  fields. `deployToken` itself stays as the legacy token-cache field (the
  `SITECOREAI_ENV_<ENV>_DEPLOY_TOKEN` env-var override target). There is
  no keychain `deploy-meta:` slot.
- `credential-matrix.ts` rows reflect the model: env automation client,
  org automation client, brand. A scai-minted automation client is
  reported present only when **both halves agree** — the non-secret
  metadata in the config AND the secret in the keychain. The
  bring-your-own-client `envClient` presence check is `clientId` +
  `useClientCredentials` (the matrix never reads secrets).

## Representations that must agree with this document

- `EnvironmentConfiguration` / config types (`src/config/types.ts`)
- `src/config/schema.json`
- `sitecore.cli.example.json`
- the keychain slots (`src/shared/keychain.ts`)
- `src/shared/credential-matrix.ts`
- the `scai setup client` command surface (incl. the brand verb)
- `scai setup status`
