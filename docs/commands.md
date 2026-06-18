<!-- AUTO-GENERATED: do not edit by hand. Run `pnpm docs:commands` to refresh. -->

# Command reference

Generated from the Commander tree assembled by `createProgram` in `src/program.ts`.
The canonical source is always `scai <command> --help`; this file is for browsing on GitHub or in IDEs.

## scai

SitecoreAI developer toolkit — deploy, serialization, recipes, publishing, and MCP

**Top-level commands**

- [`setup`](#scai-setup) — Configure environments and authenticate — init, login, env, logout, status
- [`capabilities`](#scai-capabilities) — Print the scai ↔ orchestrator sync contract version, features, and supported kinds (handshake).
- [`doctor`](#scai-doctor) — Diagnose local config + credentials. Walks sitecoreai.cli.json, the OS keychain, and the Node runtime to surface what needs fixing before remote calls will work. Different from `scai cli health`, which probes the live tenant.
- [`policy`](#scai-policy) — Inspect and manage the workspace environment-policy guardrails — the allowlist of Sitecore environments scai may operate against.
- [`hygiene`](#scai-hygiene) — Content quality — read-only audits, mutating cleanup, and composed diagnostics
- [`content`](#scai-content) — Operate on content items — publish and workflow handlers
- [`ops`](#scai-ops) — Sitecore Content Operations — briefs and campaigns
- [`brand`](#scai-brand) — [unstable] Sitecore brand surface (Brand Management + Brand Review). Provision the credential with `scai setup login brand`.
- [`agents`](#scai-agents) — [unstable] Sitecore Agentic Studio — agents, skills, tools, widgets, schemas, custom MCPs.
- [`provision`](#scai-provision) — Provision environments and content-as-code — deploy, serialization, recipes
- [`sync`](#scai-sync) — Pull, diff, and push every brand kit and brief type at once — the cross-domain recipe aggregate.
- [`mcp`](#scai-mcp) — Model Context Protocol — run an MCP server exposing scai's developer-side surface to agents.
- [`cli`](#scai-cli) — CLI tooling — config, diagnostics, history, REPL

## scai setup

Configure environments and authenticate — init, login, env, logout, status

```
scai setup [options] [command]
```

**Subcommands**

- [`scai setup init`](#scai-setup-init) — Create or update an environment with project selection and SitecoreAI credentials
- [`scai setup login`](#scai-setup-login) — Authenticate with SitecoreAI and store an access token (Deploy + CM/admin scopes)
- [`scai setup client`](#scai-setup-client) — Manage an environment's credentials — automation clients (create, list, delete) and the brand key (register-brand).
- [`scai setup logout`](#scai-setup-logout) — Clear stored authentication tokens
- [`scai setup status`](#scai-setup-status) — Show configured Sitecore environments for this CLI

### scai setup init

Create or update an environment with project selection and SitecoreAI credentials

```
scai setup init [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--cm, --host <url>` — Sitecore CM host (base URL)
- `--ref <name>` — Reference an existing environment for auth
- `--allow-write` — Allow write operations for this environment
- `--wizard` — Run the interactive setup wizard
- `--skip-deploy-lookup` — Skip Deploy API lookups and prompt for the CM host directly
- `--organization-id <id>` — Sitecore organization ID (written to the profile)
- `--tenant-id <id>` — Sitecore tenant ID (written to the profile)
- `--deploy-organization <value>` — Organization name or ID for the Deploy API environment lookup
- `--project <value>` — Project name or ID for the Deploy API lookup
- `--deploy-environment <value>` — Environment name or ID for the Deploy API environment lookup
- `--deploy-token <token>` — SitecoreAI access token (Deploy + CM/admin scopes)
- `--client-id <id>` — SitecoreAI client ID
- `--client-secret <secret>` — SitecoreAI client secret
- `--use-client-credentials` — Use client credentials instead of interactive login
- `--set-default` — Set as default environment

### scai setup login

Authenticate with SitecoreAI and store an access token (Deploy + CM/admin scopes)

```
scai setup login [options] [command]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--client-id <id>` — SitecoreAI client ID
- `--client-secret <secret>` — SitecoreAI client secret
- `--use-client-credentials` — Use client credentials instead of interactive login
- `--print` — Print the access token to stdout

**Subcommands**

- [`scai setup login brand`](#scai-setup-login-brand) — Deprecated alias for `scai setup client register-brand` — register an AI APIs key (the brand credential).

#### scai setup login brand

Deprecated alias for `scai setup client register-brand` — register an AI APIs key (the brand credential).

**Aliases:** `ai-skills`, `ai-skill`, `aiskills`, `aiskill`

```
scai setup login brand [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--org-id <id>` — Sitecore organizationId to bind the credential to. Defaults to the env profile's organizationId.
- `--client-id <id>` — AI APIs key Client ID
- `--client-secret <secret>` — AI APIs key Client Secret
- `--authority <url>` — OAuth authority. Defaults to https://auth.sitecorecloud.io.
- `--audience <url>` — OAuth audience. Defaults to https://api.sitecorecloud.io.
- `--force` — Overwrite an existing credential for this org without prompting

### scai setup client

Manage an environment's credentials — automation clients (create, list, delete) and the brand key (register-brand).

```
scai setup client [options] [command]
```

**Subcommands**

- [`scai setup client create`](#scai-setup-client-create) — Mint an automation client — env-scoped by default, org-scoped with --org (idempotent).
- [`scai setup client list`](#scai-setup-client-list) — List the automation clients in an environment's organization.
- [`scai setup client delete`](#scai-setup-client-delete) — Delete one automation client from an environment's organization.
- [`scai setup client register-brand`](#scai-setup-client-register-brand) — Register a Sitecore AI APIs key (the brand credential) for the org behind the active environment — powers `scai brand`. Credential registration, not minting.

#### scai setup client create

Mint an automation client — env-scoped by default, org-scoped with --org (idempotent).

```
scai setup client create [options] [env]
```

**Options**

- `--org` — Mint the organization-scoped automation client (shared by every env in the org) instead of the env-scoped one.
- `-w, --what-if` — Preview the action without minting or deleting.
- `--rotate` — Delete and re-mint the client even if one is already provisioned.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai setup client list

List the automation clients in an environment's organization.

```
scai setup client list [options] [env]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai setup client delete

Delete one automation client from an environment's organization.

```
scai setup client delete [options] <id> [env]
```

**Options**

- `-f, --force` — Skip the delete confirmation prompt.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai setup client register-brand

Register a Sitecore AI APIs key (the brand credential) for the org behind the active environment — powers `scai brand`. Credential registration, not minting.

**Aliases:** `brand`

```
scai setup client register-brand [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--org-id <id>` — Sitecore organizationId to bind the credential to. Defaults to the env profile's organizationId.
- `--client-id <id>` — AI APIs key Client ID
- `--client-secret <secret>` — AI APIs key Client Secret
- `--authority <url>` — OAuth authority. Defaults to https://auth.sitecorecloud.io.
- `--audience <url>` — OAuth audience. Defaults to https://api.sitecorecloud.io.
- `--force` — Overwrite an existing credential for this org without prompting

### scai setup logout

Clear stored authentication tokens

```
scai setup logout [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--all` — Clear tokens for all environments

### scai setup status

Show configured Sitecore environments for this CLI

```
scai setup status [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai capabilities

Print the scai ↔ orchestrator sync contract version, features, and supported kinds (handshake).

```
scai capabilities [options]
```

**Options**

- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai doctor

Diagnose local config + credentials. Walks sitecoreai.cli.json, the OS keychain, and the Node runtime to surface what needs fixing before remote calls will work. Different from `scai cli health`, which probes the live tenant.

```
scai doctor [options]
```

**Options**

- `--strict` — Exit non-zero on any warning (not just failures). Useful in CI to enforce a clean baseline.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai policy

Inspect and manage the workspace environment-policy guardrails — the allowlist of Sitecore environments scai may operate against.

```
scai policy [options] [command]
```

**Subcommands**

- [`scai policy show`](#scai-policy-show) — Show the effective workspace policy and the enrolled environments.
- [`scai policy init`](#scai-policy-init) — Create the workspace policy, enrolling the default environment.
- [`scai policy allow`](#scai-policy-allow) — Enroll an environment into the workspace-policy allowlist.
- [`scai policy set`](#scai-policy-set) — Tune an enrolled environment — ceiling, CI-write permission, mint eligibility.
- [`scai policy remove`](#scai-policy-remove) — Remove an environment from the workspace-policy allowlist.
- [`scai policy trust`](#scai-policy-trust) — Re-pin an enrolled environment's tenant identity to the current config, after a legitimate change.

### scai policy show

Show the effective workspace policy and the enrolled environments.

```
scai policy show [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai policy init

Create the workspace policy, enrolling the default environment.

```
scai policy init [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai policy allow

Enroll an environment into the workspace-policy allowlist.

```
scai policy allow [options] [env]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai policy set

Tune an enrolled environment — ceiling, CI-write permission, mint eligibility.

```
scai policy set [options] [env]
```

**Options**

- `--ceiling <tier>` — Cap the environment at this risk tier.
- `--ci-writes <state>` — Allow or deny write/destructive operations from a CI caller.
- `--mint <state>` — Allow or deny `scai setup client create` minting on this environment.
- `--step-up <minutes>` — Require a deploy token authenticated within N minutes for destructive/mint ops; 'off' to clear.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai policy remove

Remove an environment from the workspace-policy allowlist.

**Aliases:** `rm`

```
scai policy remove [options] [env]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai policy trust

Re-pin an enrolled environment's tenant identity to the current config, after a legitimate change.

```
scai policy trust [options] [env]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai hygiene

Content quality — read-only audits, mutating cleanup, and composed diagnostics

```
scai hygiene [options] [command]
```

**Subcommands**

- [`scai hygiene audit`](#scai-hygiene-audit) — Read-only diagnostics over Sitecore content — links, media, archive, workflow, languages, templates, datasources, duplicates, empty items, page designs, personalization
- [`scai hygiene cleanup`](#scai-hygiene-cleanup) — Mutating hygiene operations — versions, archive, templates, duplicates, find-replace, workflow, folders, roles, users. Honours --what-if and --allow-write.
- [`scai hygiene explain`](#scai-hygiene-explain) — Compose multiple audits to answer specific operator questions

### scai hygiene audit

Read-only diagnostics over Sitecore content — links, media, archive, workflow, languages, templates, datasources, duplicates, empty items, page designs, personalization

```
scai hygiene audit [options] [command]
```

**Subcommands**

- [`scai hygiene audit all`](#scai-hygiene-audit-all) — Run every audit and emit a consolidated report (skip find-replace; it needs --pattern)
- [`scai hygiene audit alt-text-missing`](#scai-hygiene-audit-alt-text-missing) — Find Image-field values with empty alt text (accessibility audit)
- [`scai hygiene audit baseline`](#scai-hygiene-audit-baseline) — Manage the per-env audit baseline (ignore-list of accepted findings)
- [`scai hygiene audit broken-images`](#scai-hygiene-audit-broken-images) — Find <img src> URLs in RichText fields that fail HTTP HEAD (404, timeout, network)
- [`scai hygiene audit broken-links`](#scai-hygiene-audit-broken-links) — Find content items with internal links that point to deleted items
- [`scai hygiene audit heavy-templates`](#scai-hygiene-audit-heavy-templates) — Find templates with more than N fields (slow editor + brittle fixtures)
- [`scai hygiene audit large-fields`](#scai-hygiene-audit-large-fields) — Find content items with field values exceeding a byte-size threshold
- [`scai hygiene audit missing-meta`](#scai-hygiene-audit-missing-meta) — Find items missing required (SEO) field values
- [`scai hygiene audit datasource-missing`](#scai-hygiene-audit-datasource-missing) — Find page items with rendering datasources that don't resolve
- [`scai hygiene audit dead-templates`](#scai-hygiene-audit-dead-templates) — Find item templates with zero items derived from them
- [`scai hygiene audit duplicates`](#scai-hygiene-audit-duplicates) — Find items with byte-identical authored content
- [`scai hygiene audit empty-items`](#scai-hygiene-audit-empty-items) — Find items with no authored field values
- [`scai hygiene audit empty-links`](#scai-hygiene-audit-empty-links) — Find General Link / CTA fields that are structurally empty (link goes nowhere)
- [`scai hygiene audit empty-roles`](#scai-hygiene-audit-empty-roles) — Find roles with zero direct members
- [`scai hygiene audit fallback-drift`](#scai-hygiene-audit-fallback-drift) — Find items where target-language versions lag the reference language by N days
- [`scai hygiene audit find-replace`](#scai-hygiene-audit-find-replace) — Search content field values for a pattern (regex or literal). Read-only counterpart to `cleanup find-replace`.
- [`scai hygiene audit language-data`](#scai-hygiene-audit-language-data) — Find items with empty per-language entries (no versions) — read-only diagnostic
- [`scai hygiene audit orphans`](#scai-hygiene-audit-orphans) — Find items in the Sitecore archive (recycle bin) — the XM Cloud analogue of orphan items
- [`scai hygiene audit page-design-orphans`](#scai-hygiene-audit-page-design-orphans) — Find pages referencing missing page designs (XM Cloud SXA)
- [`scai hygiene audit personalization-broken`](#scai-hygiene-audit-personalization-broken) — Find pages with personalization rules referencing missing items
- [`scai hygiene audit references`](#scai-hygiene-audit-references) — Find every item with a field that references a target item — generic inbound-reference scan
- [`scai hygiene audit role-bloat`](#scai-hygiene-audit-role-bloat) — Find users with more than N role memberships (default 10)
- [`scai hygiene audit site-residue`](#scai-hygiene-audit-site-residue) — Find SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)
- [`scai hygiene audit slug-conflicts`](#scai-hygiene-audit-slug-conflicts) — Find siblings sharing the same item name (URL conflict)
- [`scai hygiene audit stale-content`](#scai-hygiene-audit-stale-content) — Find content items not updated in N days — the abandoned-content (graveyard) signal
- [`scai hygiene audit stale-users`](#scai-hygiene-audit-stale-users) — Find users inactive for N days (default 180)
- [`scai hygiene audit stale-workflow`](#scai-hygiene-audit-stale-workflow) — Find items stuck in a workflow state past a stale-after threshold
- [`scai hygiene audit template-dependencies`](#scai-hygiene-audit-template-dependencies) — List every item that references a given template — primary template, base template, insert options, or branch source
- [`scai hygiene audit history`](#scai-hygiene-audit-history) — Snapshot audit-all results over time + diff across snapshots
- [`scai hygiene audit suite`](#scai-hygiene-audit-suite) — Run a YAML-defined audit pipeline (codified hygiene policy)
- [`scai hygiene audit translation-coverage`](#scai-hygiene-audit-translation-coverage) — Measure translation coverage between a reference and target language(s)
- [`scai hygiene audit unused-media`](#scai-hygiene-audit-unused-media) — Find media library items with zero references from content

#### scai hygiene audit all

Run every audit and emit a consolidated report (skip find-replace; it needs --pattern)

```
scai hygiene audit all [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--include <audits>` — Comma-separated list of audit names to run (default: every audit except find-replace) (default: `[]`)
- `--exclude-audit <audits>` — Comma-separated list of audit names to skip (default: `[]`)
- `--update-baseline` — After running, write the current findings to the baseline file (use after manual review)
- `--root <path>` — Default content root for sub-audits (default: /sitecore/content)

#### scai hygiene audit alt-text-missing

Find Image-field values with empty alt text (accessibility audit)

```
scai hygiene audit alt-text-missing [options] [command]
```

**Subcommands**

- [`scai hygiene audit alt-text-missing list`](#scai-hygiene-audit-alt-text-missing-list) — List items whose Image fields have empty or missing alt attribute

##### scai hygiene audit alt-text-missing list

List items whose Image fields have empty or missing alt attribute

```
scai hygiene audit alt-text-missing list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language

#### scai hygiene audit baseline

Manage the per-env audit baseline (ignore-list of accepted findings)

```
scai hygiene audit baseline [options] [command]
```

**Subcommands**

- [`scai hygiene audit baseline show`](#scai-hygiene-audit-baseline-show) — Print the current baseline contents
- [`scai hygiene audit baseline create`](#scai-hygiene-audit-baseline-create) — Run audits and add every current finding to the baseline (accept-all snapshot)
- [`scai hygiene audit baseline remove`](#scai-hygiene-audit-baseline-remove) — Remove a single entry from the baseline
- [`scai hygiene audit baseline reset`](#scai-hygiene-audit-baseline-reset) — Wipe the baseline for one audit (or all audits if --audit is omitted)
- [`scai hygiene audit baseline accept`](#scai-hygiene-audit-baseline-accept) — Read a `ScaiEnvelope` from stdin (an audit's --json output) and add its findings to the baseline

##### scai hygiene audit baseline show

Print the current baseline contents

```
scai hygiene audit baseline show [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai hygiene audit baseline create

Run audits and add every current finding to the baseline (accept-all snapshot)

```
scai hygiene audit baseline create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--audits <names>` — Comma-separated audit names to snapshot. Default: all audits (default: `[]`)
- `--reset` — Reset the baseline for the chosen audits before adding new entries
- `--root <path>` — Default content root (default: /sitecore/content)
- `--limit <count>` — Cap on items per audit
- `--include-system` — Include /sitecore/system items

##### scai hygiene audit baseline remove

Remove a single entry from the baseline

```
scai hygiene audit baseline remove [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--audit <name>` — Audit name (e.g. broken-links)
- `--fingerprint <hex>` — Fingerprint shown by `audit baseline show`

##### scai hygiene audit baseline reset

Wipe the baseline for one audit (or all audits if --audit is omitted)

```
scai hygiene audit baseline reset [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--audit <name>` — Audit name to reset (default: all)

##### scai hygiene audit baseline accept

Read a `ScaiEnvelope` from stdin (an audit's --json output) and add its findings to the baseline

```
scai hygiene audit baseline accept [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--audit <name>` — Audit name the findings belong to (e.g. broken-links). Must match the audit that produced the envelope.
- `--note <text>` — Optional note recorded with every accepted entry
- `--from-stdin` — Read the audit envelope from stdin (required; pipe `audit X list --json` in)

#### scai hygiene audit broken-images

Find <img src> URLs in RichText fields that fail HTTP HEAD (404, timeout, network)

```
scai hygiene audit broken-images [options] [command]
```

**Subcommands**

- [`scai hygiene audit broken-images list`](#scai-hygiene-audit-broken-images-list) — Probe each <img> URL with HEAD and report non-2xx / timeouts

##### scai hygiene audit broken-images list

Probe each <img> URL with HEAD and report non-2xx / timeouts

```
scai hygiene audit broken-images list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--request-timeout-ms <ms>` — Per-URL HEAD timeout in ms (default 5000)
- `--url-limit <count>` — Max distinct URLs probed in one run (default 500)
- `--exclude-domains <hosts>` — Comma-separated hostnames to skip (e.g. third-party CDNs you can't reach) (default: `[]`)

#### scai hygiene audit broken-links

Find content items with internal links that point to deleted items

```
scai hygiene audit broken-links [options] [command]
```

**Subcommands**

- [`scai hygiene audit broken-links list`](#scai-hygiene-audit-broken-links-list) — List items containing broken internal links (RichText, General Link, Multilist)

##### scai hygiene audit broken-links list

List items containing broken internal links (RichText, General Link, Multilist)

```
scai hygiene audit broken-links list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)

#### scai hygiene audit heavy-templates

Find templates with more than N fields (slow editor + brittle fixtures)

```
scai hygiene audit heavy-templates [options] [command]
```

**Subcommands**

- [`scai hygiene audit heavy-templates list`](#scai-hygiene-audit-heavy-templates-list) — List templates with field count >= --threshold (default 50)

##### scai hygiene audit heavy-templates list

List templates with field count >= --threshold (default 50)

```
scai hygiene audit heavy-templates list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Template-tree root (default: /sitecore/templates)
- `--threshold <count>` — Field-count threshold (default 50)

#### scai hygiene audit large-fields

Find content items with field values exceeding a byte-size threshold

```
scai hygiene audit large-fields [options] [command]
```

**Subcommands**

- [`scai hygiene audit large-fields list`](#scai-hygiene-audit-large-fields-list) — List items whose individual field values are >= --threshold bytes (default 100KB)

##### scai hygiene audit large-fields list

List items whose individual field values are >= --threshold bytes (default 100KB)

```
scai hygiene audit large-fields list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--threshold <bytes>` — Field-size threshold in bytes (default 100000 = 100KB)
- `--include-system-fields` — Include \_\_-prefixed system fields in the size check

#### scai hygiene audit missing-meta

Find items missing required (SEO) field values

```
scai hygiene audit missing-meta [options] [command]
```

**Subcommands**

- [`scai hygiene audit missing-meta list`](#scai-hygiene-audit-missing-meta-list) — List items lacking any of the required fields (default SEO set)

##### scai hygiene audit missing-meta list

List items lacking any of the required fields (default SEO set)

```
scai hygiene audit missing-meta list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--required-fields <names>` — Comma-separated required field names (default: meta-title,meta-description,og-image,og-title) (default: `[]`)
- `--template-pattern <regex>` — Only check items whose templateName matches (e.g. 'Page' for SXA pages)

#### scai hygiene audit datasource-missing

Find page items with rendering datasources that don't resolve

```
scai hygiene audit datasource-missing [options] [command]
```

**Subcommands**

- [`scai hygiene audit datasource-missing list`](#scai-hygiene-audit-datasource-missing-list) — List items whose \_\_Renderings / \_\_Final Renderings reference missing datasources

##### scai hygiene audit datasource-missing list

List items whose \_\_Renderings / \_\_Final Renderings reference missing datasources

```
scai hygiene audit datasource-missing list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--report-query-datasources` — Also report Sitecore query: and local: datasources (which can't be resolved statically)

#### scai hygiene audit dead-templates

Find item templates with zero items derived from them

```
scai hygiene audit dead-templates [options] [command]
```

**Subcommands**

- [`scai hygiene audit dead-templates list`](#scai-hygiene-audit-dead-templates-list) — List unused item templates

##### scai hygiene audit dead-templates list

List unused item templates

```
scai hygiene audit dead-templates list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Template-tree root to scan (default: /sitecore/templates)

#### scai hygiene audit duplicates

Find items with byte-identical authored content

```
scai hygiene audit duplicates [options] [command]
```

**Subcommands**

- [`scai hygiene audit duplicates list`](#scai-hygiene-audit-duplicates-list) — List duplicate-content groups (>= 2 members each, by default)

##### scai hygiene audit duplicates list

List duplicate-content groups (>= 2 members each, by default)

```
scai hygiene audit duplicates list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--language <code>` — Restrict to one language (default: include all)
- `--min-group-size <count>` — Only report groups with at least this many duplicates (default: 2)
- `--include-system-fields` — Include \_\_-prefixed system fields when computing the content hash (off by default to ignore per-item metadata)

#### scai hygiene audit empty-items

Find items with no authored field values

```
scai hygiene audit empty-items [options] [command]
```

**Subcommands**

- [`scai hygiene audit empty-items list`](#scai-hygiene-audit-empty-items-list) — List items where every non-system field is empty or whitespace

##### scai hygiene audit empty-items list

List items where every non-system field is empty or whitespace

```
scai hygiene audit empty-items list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--language <code>` — Restrict to one language (default: include all)

#### scai hygiene audit empty-links

Find General Link / CTA fields that are structurally empty (link goes nowhere)

```
scai hygiene audit empty-links [options] [command]
```

**Subcommands**

- [`scai hygiene audit empty-links list`](#scai-hygiene-audit-empty-links-list) — List items whose Link fields have no target (the visible button, the invisible href)

##### scai hygiene audit empty-links list

List items whose Link fields have no target (the visible button, the invisible href)

```
scai hygiene audit empty-links list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--template-pattern <regex>` — Restrict to items whose templateName matches this pattern (e.g. CTA\|Button\|Card)

#### scai hygiene audit empty-roles

Find roles with zero direct members

```
scai hygiene audit empty-roles [options] [command]
```

**Subcommands**

- [`scai hygiene audit empty-roles list`](#scai-hygiene-audit-empty-roles-list) — List roles whose members(first:1) returns an empty connection

##### scai hygiene audit empty-roles list

List roles whose members(first:1) returns an empty connection

```
scai hygiene audit empty-roles list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--domain <name>` — Restrict to a specific domain (e.g. sitecore, extranet)

#### scai hygiene audit fallback-drift

Find items where target-language versions lag the reference language by N days

```
scai hygiene audit fallback-drift [options] [command]
```

**Subcommands**

- [`scai hygiene audit fallback-drift list`](#scai-hygiene-audit-fallback-drift-list) — Compare updatedDate between --reference-language and --target-language versions

##### scai hygiene audit fallback-drift list

Compare updatedDate between --reference-language and --target-language versions

```
scai hygiene audit fallback-drift list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--target-languages <codes>` — Comma-separated target language codes (e.g. fr,de,es) (default: `[]`)
- `--reference-language <code>` — Reference (source) language (default: en)
- `--drift-days <count>` — Flag items where target lags reference by this many days (default 30)

#### scai hygiene audit find-replace

Search content field values for a pattern (regex or literal). Read-only counterpart to `cleanup find-replace`.

```
scai hygiene audit find-replace [options] [command]
```

**Subcommands**

- [`scai hygiene audit find-replace list`](#scai-hygiene-audit-find-replace-list) — List items whose fields contain matches for --pattern

##### scai hygiene audit find-replace list

List items whose fields contain matches for --pattern

```
scai hygiene audit find-replace list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--pattern <regex>` — Regex pattern (or literal string with --literal) to match against field values
- `--literal` — Treat --pattern as a literal string (regex special chars escaped)
- `--ignore-case` — Case-insensitive match (sets the i regex flag)
- `--flags <flags>` — Custom regex flags (g is always added). Default 'g'
- `--fields <names>` — Comma-separated field names to search (default: all author-facing fields) (default: `[]`)
- `--include-system-fields` — Include \_\_-prefixed system fields in the search (off by default)
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--max-matches-per-item <count>` — Maximum number of sample snippets captured per matching item (default 10)

#### scai hygiene audit language-data

Find items with empty per-language entries (no versions) — read-only diagnostic

```
scai hygiene audit language-data [options] [command]
```

**Subcommands**

- [`scai hygiene audit language-data list`](#scai-hygiene-audit-language-data-list) — List (item, language) pairs where the language entry exists but has zero versions

##### scai hygiene audit language-data list

List (item, language) pairs where the language entry exists but has zero versions

```
scai hygiene audit language-data list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--languages <value>` — Comma-separated language codes to inspect (default: all languages found under --root) (default: `[]`)

#### scai hygiene audit orphans

Find items in the Sitecore archive (recycle bin) — the XM Cloud analogue of orphan items

```
scai hygiene audit orphans [options] [command]
```

**Subcommands**

- [`scai hygiene audit orphans list`](#scai-hygiene-audit-orphans-list) — List archived (orphan) items

##### scai hygiene audit orphans list

List archived (orphan) items

```
scai hygiene audit orphans list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--archive-name <name>` — Limit to a specific archive (default: all archives)
- `--page-size <count>` — Page size for the archive listing
- `--limit <count>` — Maximum number of archived items to return

#### scai hygiene audit page-design-orphans

Find pages referencing missing page designs (XM Cloud SXA)

```
scai hygiene audit page-design-orphans [options] [command]
```

**Subcommands**

- [`scai hygiene audit page-design-orphans list`](#scai-hygiene-audit-page-design-orphans-list) — List pages whose \_\_Final Page Design / \_\_Page Design field points to a missing item

##### scai hygiene audit page-design-orphans list

List pages whose \_\_Final Page Design / \_\_Page Design field points to a missing item

```
scai hygiene audit page-design-orphans list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)

#### scai hygiene audit personalization-broken

Find pages with personalization rules referencing missing items

```
scai hygiene audit personalization-broken [options] [command]
```

**Subcommands**

- [`scai hygiene audit personalization-broken list`](#scai-hygiene-audit-personalization-broken-list) — List items with broken personalization variant or rule-set references

##### scai hygiene audit personalization-broken list

List items with broken personalization variant or rule-set references

```
scai hygiene audit personalization-broken list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)

#### scai hygiene audit references

Find every item with a field that references a target item — generic inbound-reference scan

```
scai hygiene audit references [options] [command]
```

**Subcommands**

- [`scai hygiene audit references list`](#scai-hygiene-audit-references-list) — List inbound references to an item

##### scai hygiene audit references list

List inbound references to an item

```
scai hygiene audit references list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--to <guid>` — Item ID to find references for (any GUID form)
- `--root <path>` — Content root to scan (default: /sitecore/content)
- `--fields <name>` — Restrict scan to these field names. Repeat or comma-separate. (default: `[]`)
- `--exclude-system-fields` — Skip `__`-prefixed system fields. Off by default — system fields (Renderings, Layout, etc.) carry most cross-item references.

#### scai hygiene audit role-bloat

Find users with more than N role memberships (default 10)

```
scai hygiene audit role-bloat [options] [command]
```

**Subcommands**

- [`scai hygiene audit role-bloat list`](#scai-hygiene-audit-role-bloat-list) — List users whose direct role count exceeds --threshold

##### scai hygiene audit role-bloat list

List users whose direct role count exceeds --threshold

```
scai hygiene audit role-bloat list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--threshold <count>` — Role-count threshold (default 10)
- `--include-admins` — Include administrators (off by default)

#### scai hygiene audit site-residue

Find SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)

```
scai hygiene audit site-residue [options] [command]
```

**Subcommands**

- [`scai hygiene audit site-residue list`](#scai-hygiene-audit-site-residue-list) — List orphan site/tenant subtrees

##### scai hygiene audit site-residue list

List orphan site/tenant subtrees

```
scai hygiene audit site-residue list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Additional root to scan on top of the SXA defaults. Repeat or comma-separate. (default: `[]`)
- `--content-root <path>` — Override the content root walked when discovering active sites (default /sitecore/content)

#### scai hygiene audit slug-conflicts

Find siblings sharing the same item name (URL conflict)

```
scai hygiene audit slug-conflicts [options] [command]
```

**Subcommands**

- [`scai hygiene audit slug-conflicts list`](#scai-hygiene-audit-slug-conflicts-list) — List parent paths where two or more sibling items share the same name

##### scai hygiene audit slug-conflicts list

List parent paths where two or more sibling items share the same name

```
scai hygiene audit slug-conflicts list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--no-case-insensitive` — Compare slugs case-sensitively (off by default — URL routing is usually case-insensitive)

#### scai hygiene audit stale-content

Find content items not updated in N days — the abandoned-content (graveyard) signal

```
scai hygiene audit stale-content [options] [command]
```

**Subcommands**

- [`scai hygiene audit stale-content list`](#scai-hygiene-audit-stale-content-list) — List items not updated in --not-updated-in-days, optionally excluding items currently in a workflow

##### scai hygiene audit stale-content list

List items not updated in --not-updated-in-days, optionally excluding items currently in a workflow

```
scai hygiene audit stale-content list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--not-updated-in-days <count>` — Threshold in days (default: 365)
- `--language <code>` — Restrict to one language
- `--no-exclude-workflow-items` — Include items currently in a non-final workflow state (off by default to keep this distinct from `audit stale-workflow`)

#### scai hygiene audit stale-users

Find users inactive for N days (default 180)

```
scai hygiene audit stale-users [options] [command]
```

**Subcommands**

- [`scai hygiene audit stale-users list`](#scai-hygiene-audit-stale-users-list) — List users whose UserProfile.lastActivity is older than --not-active-days or null

##### scai hygiene audit stale-users list

List users whose UserProfile.lastActivity is older than --not-active-days or null

```
scai hygiene audit stale-users list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--not-active-days <count>` — Inactivity threshold in days (default 180)
- `--include-admins` — Include administrators (off by default)
- `--include-service-accounts` — Include likely service accounts (off by default; lastLoginDate doesn't reflect OAuth client-credential access)
- `--use-activity-date` — Use UserProfile.lastActivityDate instead of lastLoginDate (broader signal)

#### scai hygiene audit stale-workflow

Find items stuck in a workflow state past a stale-after threshold

```
scai hygiene audit stale-workflow [options] [command]
```

**Subcommands**

- [`scai hygiene audit stale-workflow list`](#scai-hygiene-audit-stale-workflow-list) — List items in a non-final workflow state with no updates in N days

##### scai hygiene audit stale-workflow list

List items in a non-final workflow state with no updates in N days

```
scai hygiene audit stale-workflow list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--days <count>` — Stale threshold in days (default: 30)

#### scai hygiene audit template-dependencies

List every item that references a given template — primary template, base template, insert options, or branch source

```
scai hygiene audit template-dependencies [options] [command]
```

**Subcommands**

- [`scai hygiene audit template-dependencies list`](#scai-hygiene-audit-template-dependencies-list) — List inbound references to a template

##### scai hygiene audit template-dependencies list

List inbound references to a template

```
scai hygiene audit template-dependencies list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--template-id <guid>` — Template item ID to find references for (any GUID form)
- `--skip <kind>` — Skip a reference kind: primary-template, base-template, insert-options, branch-source, datasource-template. Repeat or comma-separate. (default: `[]`)

#### scai hygiene audit history

Snapshot audit-all results over time + diff across snapshots

```
scai hygiene audit history [options] [command]
```

**Subcommands**

- [`scai hygiene audit history capture`](#scai-hygiene-audit-history-capture) — Run `audit all` and persist the result to .scai/audit-history/<env>/
- [`scai hygiene audit history list`](#scai-hygiene-audit-history-list) — List captured snapshots, newest first
- [`scai hygiene audit history diff`](#scai-hygiene-audit-history-diff) — Compare two snapshots and show per-audit deltas (defaults to last two)

##### scai hygiene audit history capture

Run `audit all` and persist the result to .scai/audit-history/<env>/

```
scai hygiene audit history capture [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--root <path>` — Default content root for sub-audits
- `--limit <count>` — Cap per audit
- `--include-system` — Include /sitecore/system items
- `--include <audits>` — Comma-separated audit names (default: `[]`)
- `--exclude-audit <audits>` — Comma-separated audit names to skip (default: `[]`)
- `--exclude <path>` — Path-prefix exclusions (default: `[]`)
- `--since <date>` — Only items updated on/after this date

##### scai hygiene audit history list

List captured snapshots, newest first

```
scai hygiene audit history list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai hygiene audit history diff

Compare two snapshots and show per-audit deltas (defaults to last two)

```
scai hygiene audit history diff [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--from <file>` — Snapshot path to compare FROM (default: second-most-recent)
- `--to <file>` — Snapshot path to compare TO (default: most-recent)

#### scai hygiene audit suite

Run a YAML-defined audit pipeline (codified hygiene policy)

```
scai hygiene audit suite [options] [command]
```

**Subcommands**

- [`scai hygiene audit suite run`](#scai-hygiene-audit-suite-run) — Execute a suite file

##### scai hygiene audit suite run

Execute a suite file

```
scai hygiene audit suite run [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--file <path>` — Path to the audit-suite YAML file
- `--only <audits>` — Comma-separated subset of suite audits to run (default: `[]`)

#### scai hygiene audit translation-coverage

Measure translation coverage between a reference and target language(s)

```
scai hygiene audit translation-coverage [options] [command]
```

**Subcommands**

- [`scai hygiene audit translation-coverage list`](#scai-hygiene-audit-translation-coverage-list) — Compare item sets between --reference-language and each --target-language

##### scai hygiene audit translation-coverage list

Compare item sets between --reference-language and each --target-language

```
scai hygiene audit translation-coverage list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--target-languages <codes>` — Comma-separated target language codes to compare (e.g. fr,de,es) (default: `[]`)
- `--reference-language <code>` — Reference (source) language (default: en)
- `--min-coverage-percent <pct>` — Only flag languages below this coverage % (default 0 = report all)

#### scai hygiene audit unused-media

Find media library items with zero references from content

```
scai hygiene audit unused-media [options] [command]
```

**Subcommands**

- [`scai hygiene audit unused-media list`](#scai-hygiene-audit-unused-media-list) — List media items that aren't referenced by any content

##### scai hygiene audit unused-media list

List media items that aren't referenced by any content

```
scai hygiene audit unused-media list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI\_HYGIENE\_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI\_HYGIENE\_BATCH\_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI\_HYGIENE\_PAGE\_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--media-root <path>` — Media library root to scan (default: /sitecore/media library)
- `--reference-root <path>` — Root under which media references are searched (default: /sitecore/content)
- `--media-limit <count>` — Cap on the number of media items inspected
- `--reference-limit <count>` — Cap on the number of reference-side items inspected

### scai hygiene cleanup

Mutating hygiene operations — versions, archive, templates, duplicates, find-replace, workflow, folders, roles, users. Honours --what-if and --allow-write.

```
scai hygiene cleanup [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup archive`](#scai-hygiene-cleanup-archive) — Operations against the Sitecore archive (recycle bin)
- [`scai hygiene cleanup dead-templates`](#scai-hygiene-cleanup-dead-templates) — Delete templates that have zero items derived from them
- [`scai hygiene cleanup duplicates`](#scai-hygiene-cleanup-duplicates) — Delete duplicate-content items, keeping one per group per --keep-rule
- [`scai hygiene cleanup empty-folders`](#scai-hygiene-cleanup-empty-folders) — Delete folder-like items with no children, recursively bottom-up
- [`scai hygiene cleanup field-set`](#scai-hygiene-cleanup-field-set) — Bulk-edit one field across a content scope — replace, add (multilist), remove (multilist), clear
- [`scai hygiene cleanup find-replace`](#scai-hygiene-cleanup-find-replace) — Apply a find-replace operation across content field values
- [`scai hygiene cleanup language-versions`](#scai-hygiene-cleanup-language-versions) — Bulk-create language versions across items so translators can pick them up
- [`scai hygiene cleanup multilist`](#scai-hygiene-cleanup-multilist) — Surgical multilist-field edits — promoted from `scai/scripting/helpers/multilist.ts` so they're reachable without an entry script
- [`scai hygiene cleanup rename`](#scai-hygiene-cleanup-rename) — Bulk-rename items by pattern (modifies item Name and thus the URL slug)
- [`scai hygiene cleanup roles`](#scai-hygiene-cleanup-roles) — Delete empty roles (the cleanup counterpart to `audit empty-roles`)
- [`scai hygiene cleanup site-residue`](#scai-hygiene-cleanup-site-residue) — Delete SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)
- [`scai hygiene cleanup slug-conflicts`](#scai-hygiene-cleanup-slug-conflicts) — Resolve sibling-name conflicts surfaced by `audit slug-conflicts` (delete or rename losers per --keep-rule)
- [`scai hygiene cleanup subtree`](#scai-hygiene-cleanup-subtree) — Delete a Sitecore subtree bottom-up, with hard-block on external inbound references
- [`scai hygiene cleanup users`](#scai-hygiene-cleanup-users) — Delete stale users (the cleanup counterpart to `audit stale-users`)
- [`scai hygiene cleanup versions`](#scai-hygiene-cleanup-versions) — Prune or archive per-item version history down to the N most recent versions
- [`scai hygiene cleanup workflow`](#scai-hygiene-cleanup-workflow) — Mutating workflow operations (advance stale items, bulk-attach a workflow, etc.)

#### scai hygiene cleanup archive

Operations against the Sitecore archive (recycle bin)

```
scai hygiene cleanup archive [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup archive purge`](#scai-hygiene-cleanup-archive-purge) — Permanently delete archived items older than --older-than-days N

##### scai hygiene cleanup archive purge

Permanently delete archived items older than --older-than-days N

```
scai hygiene cleanup archive purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--older-than-days <count>` — Only purge archived items older than N days (default: 30)
- `--limit <count>` — Cap on items purged in one run (default: 1000)
- `--archive-name <name>` — Limit to a specific archive (default: all archives)
- `--page-size <count>` — Page size for archive listing (default: 100)
- `--concurrency <count>` — Concurrency for delete calls (default: 4)

#### scai hygiene cleanup dead-templates

Delete templates that have zero items derived from them

```
scai hygiene cleanup dead-templates [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup dead-templates purge`](#scai-hygiene-cleanup-dead-templates-purge) — Delete dead templates, optionally cleaning up empty template folders left behind

##### scai hygiene cleanup dead-templates purge

Delete dead templates, optionally cleaning up empty template folders left behind

```
scai hygiene cleanup dead-templates purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--root <path>` — Template-tree root (default: /sitecore/templates/Project)
- `--limit <count>` — Cap on templates inspected (default: 5000)
- `--concurrency <count>` — Delete concurrency (default: 4)
- `--no-cleanup-empty-folders` — Skip the recursive empty-folder cleanup after templates are deleted (default: clean up)
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)

#### scai hygiene cleanup duplicates

Delete duplicate-content items, keeping one per group per --keep-rule

```
scai hygiene cleanup duplicates [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup duplicates purge`](#scai-hygiene-cleanup-duplicates-purge) — Delete duplicates per keep-rule (default: oldest creation date wins)

##### scai hygiene cleanup duplicates purge

Delete duplicates per keep-rule (default: oldest creation date wins)

```
scai hygiene cleanup duplicates purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language (default: include all)
- `--min-group-size <count>` — Only act on groups with at least this many duplicates (default: 2)
- `--limit <count>` — Cap on the number of items inspected (default: 5000)
- `--index <name>` — Override the search index name
- `--include-system` — Include /sitecore/system items in the scan (off by default)
- `--include-system-fields` — Include \_\_-prefixed system fields when computing the content hash
- `--keep-rule <rule>` — Which member of each duplicate group survives (default: `"oldest"`)
- `--concurrency <count>` — Delete concurrency (default: 4)
- `--batch-size <count>` — Aliased GraphQL batch size for field reads
- `--skip-ref-check` — Skip the inbound-reference pre-flight scan (faster on large tenants; refs to deleted dupes will become broken)
- `--from-stdin` — Read an `audit duplicates list` envelope from stdin and use its groups directly, skipping the cleanup's internal audit re-run. Pair with the audit's --json mode.

#### scai hygiene cleanup empty-folders

Delete folder-like items with no children, recursively bottom-up

```
scai hygiene cleanup empty-folders [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup empty-folders purge`](#scai-hygiene-cleanup-empty-folders-purge) — Walk --root depth-first and delete every item whose subtree is empty

##### scai hygiene cleanup empty-folders purge

Walk --root depth-first and delete every item whose subtree is empty

```
scai hygiene cleanup empty-folders purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--root <path>` — Content root to clean up under
- `--max-deletions <count>` — Cap on total deletions per run (default 500)

#### scai hygiene cleanup field-set

Bulk-edit one field across a content scope — replace, add (multilist), remove (multilist), clear

```
scai hygiene cleanup field-set [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup field-set apply`](#scai-hygiene-cleanup-field-set-apply) — Write a value to the named --field across matching items

##### scai hygiene cleanup field-set apply

Write a value to the named --field across matching items

```
scai hygiene cleanup field-set apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--field <name>` — Single field name to write (case-insensitive; resolved against the item's template)
- `--mode <mode>` — How to combine --value with the existing field state. replace (default) \| add \| remove \| clear (default: `"replace"`)
- `--value <text>` — Value to write. For mode=replace: written verbatim. For mode=add/remove: comma- or pipe-separated GUID list. Ignored for mode=clear.
- `--template-pattern <regex>` — Restrict to items whose templateName matches (strongly recommended — without this the verb operates on every item in --root)
- `--where-current-matches <regex>` — Only update items whose current value of --field matches this regex (e.g. '^$' for empty-only)
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--limit <count>` — Cap on items inspected (default: 5000)
- `--max-mutations <count>` — Maximum number of items to mutate per run (default: 100)
- `--index <name>` — Override the search index name
- `--include-system` — Include /sitecore/system items in the scan (off by default)
- `--include-system-fields` — Allow writing to \_\_-prefixed system fields (off by default)
- `--cache` — Use the on-disk field cache for the discovery phase

#### scai hygiene cleanup find-replace

Apply a find-replace operation across content field values

```
scai hygiene cleanup find-replace [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup find-replace apply`](#scai-hygiene-cleanup-find-replace-apply) — Replace --pattern with --replacement in matching field values

##### scai hygiene cleanup find-replace apply

Replace --pattern with --replacement in matching field values

```
scai hygiene cleanup find-replace apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--pattern <regex>` — Regex pattern (or literal with --literal) to match against field values
- `--replacement <text>` — Replacement string. Supports JS regex backreferences ($1, $&, $<name>)
- `--literal` — Treat --pattern as a literal string
- `--ignore-case` — Case-insensitive match
- `--flags <flags>` — Custom regex flags (g is always added). Default 'g'
- `--fields <names>` — Comma-separated field names to search (default: all author-facing fields) (default: `[]`)
- `--include-system-fields` — Include \_\_-prefixed system fields in the search (off by default; touching \_\_Renderings via regex will mangle XML)
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--limit <count>` — Cap on items inspected (default: 5000)
- `--max-mutations <count>` — Maximum number of items to mutate per run (default: 100). Defends against runaway regex matches
- `--index <name>` — Override the search index name
- `--include-system` — Include /sitecore/system items in the scan (off by default)
- `--cache` — Use the on-disk field cache for the discovery phase

#### scai hygiene cleanup language-versions

Bulk-create language versions across items so translators can pick them up

```
scai hygiene cleanup language-versions [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup language-versions add`](#scai-hygiene-cleanup-language-versions-add) — Add empty (or copied) language versions to items in --root

##### scai hygiene cleanup language-versions add

Add empty (or copied) language versions to items in --root

```
scai hygiene cleanup language-versions add [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--languages <codes>` — Comma-separated language codes to add (e.g. fr,es,de) (default: `[]`)
- `--from-language <code>` — Source language to copy fields from. Default: seed the new version empty
- `--template-pattern <regex>` — Restrict to items whose templateName matches (strongly recommended)
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--limit <count>` — Cap on items inspected (default: 5000)
- `--max-adds <count>` — Maximum number of (item, language) versions created per run (default: 500)
- `--index <name>` — Override the search index name
- `--include-system` — Include /sitecore/system items in the scan (off by default)
- `--cache` — Use the on-disk field cache for the discovery phase

#### scai hygiene cleanup multilist

Surgical multilist-field edits — promoted from `scai/scripting/helpers/multilist.ts` so they're reachable without an entry script

```
scai hygiene cleanup multilist [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup multilist remove-ref`](#scai-hygiene-cleanup-multilist-remove-ref) — Remove one GUID from a multilist / treelist / droplink-list field on a single item. Case-insensitive, brace-tolerant. Use --what-if first to see the before/after.

##### scai hygiene cleanup multilist remove-ref

Remove one GUID from a multilist / treelist / droplink-list field on a single item. Case-insensitive, brace-tolerant. Use --what-if first to see the before/after.

```
scai hygiene cleanup multilist remove-ref [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--item-id <guid>` — Target item GUID (with or without braces)
- `--field <name>` — Field name to mutate (must be a multilist-shaped field)
- `--ref <guid>` — GUID to remove from the field
- `--language <code>` — Sitecore language code (e.g. en, en-US, fr-CA)

#### scai hygiene cleanup rename

Bulk-rename items by pattern (modifies item Name and thus the URL slug)

```
scai hygiene cleanup rename [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup rename apply`](#scai-hygiene-cleanup-rename-apply) — Rename items whose name matches --pattern to the --replacement form

##### scai hygiene cleanup rename apply

Rename items whose name matches --pattern to the --replacement form

```
scai hygiene cleanup rename apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--pattern <regex>` — JS regex (or literal with --literal) applied to item Name
- `--replacement <text>` — Replacement string. Supports JS regex backreferences ($1, $&, $<name>)
- `--literal` — Treat --pattern as a literal string
- `--ignore-case` — Case-insensitive match
- `--flags <flags>` — Custom regex flags (g intentionally not added)
- `--template-pattern <regex>` — Restrict to items whose templateName matches (strongly recommended)
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--limit <count>` — Cap on items inspected (default: 5000)
- `--max-renames <count>` — Maximum number of items renamed per run (default: 100)
- `--index <name>` — Override the search index name
- `--include-system` — Include /sitecore/system items in the scan (off by default)
- `--cache` — Use the on-disk field cache for the discovery phase

#### scai hygiene cleanup roles

Delete empty roles (the cleanup counterpart to `audit empty-roles`)

```
scai hygiene cleanup roles [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup roles purge-empty`](#scai-hygiene-cleanup-roles-purge-empty) — Delete every role flagged by `audit empty-roles list`

##### scai hygiene cleanup roles purge-empty

Delete every role flagged by `audit empty-roles list`

```
scai hygiene cleanup roles purge-empty [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--domain <name>` — Restrict to a specific domain
- `--max-deletions <count>` — Cap on total deletions per run (default 50)

#### scai hygiene cleanup site-residue

Delete SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)

```
scai hygiene cleanup site-residue [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup site-residue purge`](#scai-hygiene-cleanup-site-residue-purge) — Delete orphan tenant/site subtrees identified by `audit site-residue`. Defaults to plan-mode; combine --what-if with --allow-write to mutate.

##### scai hygiene cleanup site-residue purge

Delete orphan tenant/site subtrees identified by `audit site-residue`. Defaults to plan-mode; combine --what-if with --allow-write to mutate.

```
scai hygiene cleanup site-residue purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--root <path>` — Additional root to scan on top of the SXA defaults. Repeat or comma-separate. (default: `[]`)
- `--content-root <path>` — Override the content root walked when discovering active sites (default /sitecore/content)
- `--skip-ref-check` — Skip the inbound-ref pre-flight scan. Faster but loses the safety net — pair with `audit broken-links` if you use this.
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--concurrency <count>` — Concurrent deletes / pre-flight scans (default: 4)

#### scai hygiene cleanup slug-conflicts

Resolve sibling-name conflicts surfaced by `audit slug-conflicts` (delete or rename losers per --keep-rule)

```
scai hygiene cleanup slug-conflicts [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup slug-conflicts purge`](#scai-hygiene-cleanup-slug-conflicts-purge) — Delete or rename losing siblings per --keep-rule (default: oldest wins, action delete)

##### scai hygiene cleanup slug-conflicts purge

Delete or rename losing siblings per --keep-rule (default: oldest wins, action delete)

```
scai hygiene cleanup slug-conflicts purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language (default: include all)
- `--limit <count>` — Cap on the number of items inspected (default: 5000)
- `--index <name>` — Override the search index name
- `--include-system` — Include /sitecore/system items in the scan (off by default)
- `--case-insensitive` — Treat sibling names as case-insensitive (default: on; pass --no-case-insensitive to disable)
- `--no-case-insensitive` — Treat sibling names as case-sensitive (off by default — most renderers do case-insensitive URL resolution)
- `--keep-rule <rule>` — Which member of each conflict group survives (default: `"oldest"`)
- `--action <action>` — What to do with the losers (default: `"delete"`)
- `--rename-suffix <template>` — Suffix template for --action rename. Placeholders: {shortId} (8-char itemId prefix), {full} (32-char id). Default: '-{shortId}'.
- `--concurrency <count>` — Delete/rename concurrency (default: 4)
- `--check-refs` — Pre-scan inbound references for every loser. In preview, attaches counts to each row (warn-only). Under --apply, fails the run if any loser has positive counts.
- `--ref-check-root <path>` — Content root the inbound-ref scan walks. Default '/sitecore' (full tenant). Narrow if you know refs only come from a subtree. Ignored without --check-refs.

#### scai hygiene cleanup subtree

Delete a Sitecore subtree bottom-up, with hard-block on external inbound references

```
scai hygiene cleanup subtree [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup subtree delete`](#scai-hygiene-cleanup-subtree-delete) — Walk a subtree leaf-first and delete every descendant + the root

##### scai hygiene cleanup subtree delete

Walk a subtree leaf-first and delete every descendant + the root

```
scai hygiene cleanup subtree delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--path <content-tree-path>` — Subtree root to delete
- `--scan-root <path>` — Content root to scan for inbound references (default: /sitecore — the entire CMS)
- `--orphan-external-refs <mode>` — How to handle external items whose fields reference the subtree. Default: refuse with blocker list. 'clear' empties the entire referring field. 'prune' surgically removes only the entries pointing at the subtree (preserves sibling values in multi-list / treelist fields and `<r>` elements in `__Renderings` layout XML). 'leave' skips the ref scan entirely — fastest, accepts dangling refs, expects `audit broken-links` follow-up.
- `--max-deletions <count>` — Hard cap on items deleted in one run (default: 1000)
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--fields <name>` — Restrict inbound-ref scan to these field names. Repeat or comma-separate. (default: `[]`)

#### scai hygiene cleanup users

Delete stale users (the cleanup counterpart to `audit stale-users`)

```
scai hygiene cleanup users [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup users purge-stale`](#scai-hygiene-cleanup-users-purge-stale) — Delete users inactive for more than --not-active-days (default 365)

##### scai hygiene cleanup users purge-stale

Delete users inactive for more than --not-active-days (default 365)

```
scai hygiene cleanup users purge-stale [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--not-active-days <count>` — Inactivity threshold in days (default 365)
- `--max-deletions <count>` — Cap on total deletions per run (default 25)
- `--include-admins` — Include administrators (strongly discouraged)
- `--include-service-accounts` — Include likely service accounts (their lastLoginDate doesn't reflect OAuth access)
- `--use-activity-date` — Use UserProfile.lastActivityDate instead of lastLoginDate

#### scai hygiene cleanup versions

Prune or archive per-item version history down to the N most recent versions

```
scai hygiene cleanup versions [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup versions prune`](#scai-hygiene-cleanup-versions-prune) — Permanently delete versions older than the N most recent per (item, language)
- [`scai hygiene cleanup versions archive`](#scai-hygiene-cleanup-versions-archive) — Move versions older than the N most recent per (item, language) to the Sitecore archive (reversible)

##### scai hygiene cleanup versions prune

Permanently delete versions older than the N most recent per (item, language)

```
scai hygiene cleanup versions prune [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--keep <count>` — Number of most-recent versions to keep per (item, language)
- `--root <path>` — Content-tree root to scope the prune (e.g. /sitecore/content/MySite)
- `--language <code>` — Restrict pruning to one language (default: all languages found per item)
- `--limit <count>` — Cap on the number of items inspected
- `--index <name>` — Override the search index name (default: sitecore\_master\_index)
- `--concurrency <count>` — Concurrency for version reads and deletes
- `--include-system` — Include /sitecore/system and platform items in the prune

##### scai hygiene cleanup versions archive

Move versions older than the N most recent per (item, language) to the Sitecore archive (reversible)

```
scai hygiene cleanup versions archive [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--keep <count>` — Number of most-recent versions to keep per (item, language)
- `--root <path>` — Content-tree root to scope the archive
- `--language <code>` — Restrict to one language
- `--limit <count>` — Cap on items inspected
- `--index <name>` — Override the search index name
- `--concurrency <count>` — Concurrency
- `--include-system` — Include platform items
- `--archive-name <name>` — Name of the Sitecore archive bucket (default: tenant default)

#### scai hygiene cleanup workflow

Mutating workflow operations (advance stale items, bulk-attach a workflow, etc.)

```
scai hygiene cleanup workflow [options] [command]
```

**Subcommands**

- [`scai hygiene cleanup workflow advance`](#scai-hygiene-cleanup-workflow-advance) — Execute a workflow command on items stuck past --stale-days
- [`scai hygiene cleanup workflow apply`](#scai-hygiene-cleanup-workflow-apply) — Bulk-attach a workflow to items under --root (sets \_\_Workflow + \_\_Workflow state directly). Use to backfill content authored before the workflow existed.

##### scai hygiene cleanup workflow advance

Execute a workflow command on items stuck past --stale-days

```
scai hygiene cleanup workflow advance [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--command-name <name>` — Workflow command name (e.g. 'Submit', 'Approve'). Resolved case-insensitively against the item's workflow.
- `--stale-days <count>` — Days since last update for an item to be eligible (default 30)
- `--from-state <name>` — Only act on items currently in this state name
- `--comments <text>` — Comment recorded with the workflow execution (audit trail)
- `--root <path>` — Content root (default: /sitecore/content)
- `--max-advances <count>` — Cap on items advanced per run (default 100)
- `--limit <count>` — Cap on items inspected
- `--index <name>` — Override the search index
- `--include-system` — Include /sitecore/system items

##### scai hygiene cleanup workflow apply

Bulk-attach a workflow to items under --root (sets \_\_Workflow + \_\_Workflow state directly). Use to backfill content authored before the workflow existed.

```
scai hygiene cleanup workflow apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--workflow <ref>` — Workflow GUID, content-tree path, or display/item name (case-insensitive)
- `--state <ref>` — Target state (GUID or name). Defaults to the workflow's \_\_Initial state.
- `--template <ref>` — Only attach to items conforming to this template (GUID or absolute /sitecore/templates path).
- `--reattach` — Overwrite items already attached to a different workflow. Off by default — already-attached items are skipped so the verb defaults to a safe backfill.
- `--stale-days <count>` — Only act on items not updated for at least N days. Optional — omit to attach to every match.
- `--root <path>` — Content root (default: /sitecore/content)
- `--max-applies <count>` — Cap on items attached per run (default 100)
- `--limit <count>` — Cap on items inspected (default 5000)
- `--index <name>` — Override the search index
- `--include-system` — Include /sitecore/system items

### scai hygiene explain

Compose multiple audits to answer specific operator questions

```
scai hygiene explain [options] [command]
```

**Subcommands**

- [`scai hygiene explain why-blocked`](#scai-hygiene-explain-why-blocked) — Show every inbound reference that would block a delete of <itemId>, grouped by reference kind
- [`scai hygiene explain orphan-site`](#scai-hygiene-explain-orphan-site) — Show the orphan trees left behind for <site>, flagging any still referenced by live content

#### scai hygiene explain why-blocked

Show every inbound reference that would block a delete of <itemId>, grouped by reference kind

```
scai hygiene explain why-blocked [options] <itemId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--root <path>` — Content root for the field-value scan (default: /sitecore/content)
- `--index <name>` — Override the search index name
- `--limit <count>` — Cap on results per scan kind (default: 5000)
- `--skip-content-scan` — Skip the field-value content scan. Use when only structural template refs matter (faster).
- `--skip-template-deps` — Skip the search-index template-dependency check. Use for leaf content items that aren't referenced as templates.
- `--cache` — Reuse the on-disk field cache for the content scan (faster when running back-to-back checks against the same --root).

#### scai hygiene explain orphan-site

Show the orphan trees left behind for <site>, flagging any still referenced by live content

```
scai hygiene explain orphan-site [options] <site>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--index <name>` — Override the search index name
- `--limit <count>` — Cap on inbound refs counted per orphan tree

## scai content

Operate on content items — publish and workflow handlers

```
scai content [options] [command]
```

**Subcommands**

- [`scai content publish`](#scai-content-publish) — Publish content to Experience Edge via the SAI Publishing API. Requires an environment-level automation client (Cloud Portal → Environments → [env] → Automation Clients).
- [`scai content workflow`](#scai-content-workflow) — Inspect and operate on Sitecore workflows — current state, available commands, transitions

### scai content publish

Publish content to Experience Edge via the SAI Publishing API. Requires an environment-level automation client (Cloud Portal → Environments → [env] → Automation Clients).

```
scai content publish [options] [command]
```

**Subcommands**

- [`scai content publish item`](#scai-content-publish-item) — Publish one or more items in a single job (Tier 1). Items can be addressed by GUID (--items) or by Sitecore content-tree path (--paths). At least one must be provided. Defaults to --what-if dry-run; pass --allow-write to actually publish. Production-tier envs additionally require --confirm-token from a prior dry-run.
- [`scai content publish all`](#scai-content-publish-all) — Whole-environment republish to Edge (Tier 2). Publishes every item across every site in the environment — empirically verified against the API (the `xmc.site.mode` field is named for legacy XM reasons; there is no API surface to scope to a single site). To publish just one site's subtree, use `scai content publish item --site <name> --include-subitems`. MAXIMUM gating: always requires --confirm-token AND a typed env-name confirmation, regardless of whether the env is flagged production. Use sparingly — needed after big serialization pushes, rollbacks, or migrations where Edge has drifted from CM.
- [`scai content publish status`](#scai-content-publish-status) — Show the state of a publish job, or list queued/running jobs when no jobId is given. Pass --watch to poll until the job reaches a terminal state (completed/failed/cancelled).
- [`scai content publish cancel`](#scai-content-publish-cancel) — Cancel a queued or running publish job. Pass <jobId> for one, or --all-queued to sweep every queued/running job in the env (gated behind a typed env-name confirmation). The API only honours cancellation for Queued / Running jobs; Completed / Failed / already-Cancelled jobs cannot be cancelled.
- [`scai content publish unpublish`](#scai-content-publish-unpublish) — Unpublish one or more items. Writes a publish-state field via the Authoring API (or calls deleteItem for --strategy delete), then submits a publish job so Edge picks up the removal. Defaults to the reversible `never-publish` strategy; pass --strategy expire-now to set `__Valid to: now`, or --strategy delete for permanent removal (typed-item-path confirmation required).
- [`scai content publish history`](#scai-content-publish-history) — Read the local publishing audit log at ~/.sitecoreai/audit.log (overridable via SITECOREAI\_AUDIT\_LOG). Filter by env / time / command / outcome. Use --json for newline-delimited JSON suitable for piping into jq.

#### scai content publish item

Publish one or more items in a single job (Tier 1). Items can be addressed by GUID (--items) or by Sitecore content-tree path (--paths). At least one must be provided. Defaults to --what-if dry-run; pass --allow-write to actually publish. Production-tier envs additionally require --confirm-token from a prior dry-run.

```
scai content publish item [options]
```

**Options**

- `--items <guid>` — Item ID (GUID) to publish. Repeatable, or pass a comma-separated list. (default: `[]`)
- `--paths <path>` — Item path (e.g. /sitecore/content/Home). Repeatable, or pass a comma-separated list. Resolved to item IDs via Authoring GraphQL before submission. (default: `[]`)
- `--site <name>` — Resolve the named site's content-tree root and add it to the publish target list. By default publishes ONLY the root item; combine with --include-subitems for the whole site.
- `--item-type <type>` — ItemModel.type for the request body. Defaults to `item`.
- `-l, --languages <list>` — Literal language list (e.g. en-US,fr-CA). Mutually exclusive with --languages-from-site / --all-tenant-languages. (default: `[]`)
- `--languages-from-site <name>` — Resolve the language list from the named site's configured languages (via Sites API). Logs the resolved set before submitting.
- `--all-tenant-languages` — Resolve the language list to every language registered in the tenant (via Sites API listLanguages).
- `--include-subitems` — Publish descendants of the items (xmc.items.publishChildren).
- `--include-related` — Publish referenced items (xmc.items.publishRelatedItems).
- `--mode <mode>` — Publish mode. `Smart` skips items unchanged since the last publish; `Republish` forces re-emit of every item in the batch. Incremental is whole-environment only and lives on `publish all`. (default: `"Smart"`)
- `--confirm-token <token>` — Scope token obtained from a previous dry-run. Required on production-tier envs.
- `--yes` — Skip the [y/N] prompt on non-production envs. Has no effect on production-tier — those always require --confirm-token.
- `--name <name>` — Override the API job name (the publishing UI label).
- `--source <source>` — Override the API source field. Default `scai`.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content publish all

Whole-environment republish to Edge (Tier 2). Publishes every item across every site in the environment — empirically verified against the API (the `xmc.site.mode` field is named for legacy XM reasons; there is no API surface to scope to a single site). To publish just one site's subtree, use `scai content publish item --site <name> --include-subitems`. MAXIMUM gating: always requires --confirm-token AND a typed env-name confirmation, regardless of whether the env is flagged production. Use sparingly — needed after big serialization pushes, rollbacks, or migrations where Edge has drifted from CM.

```
scai content publish all [options]
```

**Options**

- `-l, --languages <list>` — Literal language list. Mutually exclusive with --languages-from-site / --all-tenant-languages. (default: `[]`)
- `--languages-from-site <name>` — Resolve locales from the named site (Sites API). NOTE: the publish is still whole-environment — this flag scopes locales only, not items.
- `--all-tenant-languages` — Resolve locales to every language registered in the tenant.
- `--mode <mode>` — Whole-environment publish mode (default: `"Republish"`)
- `--confirm-token <token>` — Scope token from a previous dry-run. Always required for the real call.
- `--yes` — Skip the typed env-name prompt (CI use). Still requires --confirm-token.
- `--no-wait` — In --non-interactive mode (default behavior is to watch), don't wait for the job to finish — submit and exit. The submitted jobId is logged so CI can poll later.
- `--poll-interval-s <seconds>` — Polling interval when watching in non-interactive mode (default 5, clamped to [2, 60]).
- `--timeout-s <seconds>` — Watch timeout in seconds when waiting on the job in non-interactive mode (default 1800).
- `--name <name>` — Override the API job name.
- `--source <source>` — Override the API source field. Default `scai`.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content publish status

Show the state of a publish job, or list queued/running jobs when no jobId is given. Pass --watch to poll until the job reaches a terminal state (completed/failed/cancelled).

```
scai content publish status [options] [jobId]
```

**Options**

- `--watch` — Poll until the job reaches a terminal state. Requires a jobId.
- `--poll-interval-s <seconds>` — Polling interval in seconds (default 5, clamped to [2, 60]).
- `--timeout-s <seconds>` — Hard timeout for --watch in seconds (default 1800). Throws NETWORK error if the job hasn't reached a terminal state by then.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content publish cancel

Cancel a queued or running publish job. Pass <jobId> for one, or --all-queued to sweep every queued/running job in the env (gated behind a typed env-name confirmation). The API only honours cancellation for Queued / Running jobs; Completed / Failed / already-Cancelled jobs cannot be cancelled.

```
scai content publish cancel [options] [jobId]
```

**Options**

- `--all-queued` — Cancel every queued and running publish job in the env. Requires a typed env-name confirmation (or --yes in CI).
- `--yes` — Skip the typed env-name prompt when using --all-queued (CI use).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content publish unpublish

Unpublish one or more items. Writes a publish-state field via the Authoring API (or calls deleteItem for --strategy delete), then submits a publish job so Edge picks up the removal. Defaults to the reversible `never-publish` strategy; pass --strategy expire-now to set `__Valid to: now`, or --strategy delete for permanent removal (typed-item-path confirmation required).

```
scai content publish unpublish [options]
```

**Options**

- `--items <guid>` — Item ID (GUID) to unpublish. Repeatable, or pass a comma-separated list. (default: `[]`)
- `--paths <path>` — Item path (e.g. /sitecore/content/Home). Repeatable, or pass a comma-separated list. Resolved to item IDs via Authoring GraphQL before submission. (default: `[]`)
- `--site <name>` — Resolve the named site's content-tree root and add it to the target list. By default targets ONLY the root item; combine with --include-subitems to unpublish the whole site.
- `-l, --languages <list>` — Literal language list. Mutually exclusive with --languages-from-site / --all-tenant-languages. (default: `[]`)
- `--languages-from-site <name>` — Resolve the language list from the named site (Sites API).
- `--all-tenant-languages` — Resolve the language list to every language registered in the tenant.
- `--include-subitems` — Publish descendants in the follow-up publish job.
- `--include-related` — Publish referenced items in the follow-up publish job.
- `--strategy <mode>` — Unpublish mechanism. `never-publish` (default, reversible) sets `__Never publish: true`. `expire-now` (reversible) sets `__Valid to: <now>`. `delete` (NOT reversible) calls deleteItem and requires typed-item-path confirmation per item. (default: `"never-publish"`)
- `--confirm-token <token>` — Scope token obtained from a previous dry-run. Required on production-tier envs.
- `--confirm-item-path <path>` — For --strategy delete with --yes: the exact resolved item path the operator is authorizing to delete. Must match scai's path resolution for each item. Without this (and --yes), scai prompts interactively per item.
- `--yes` — Skip the [y/N] prompt on non-production envs. Has no effect on production-tier — those always require --confirm-token. For --strategy delete: also requires --confirm-item-path.
- `--name <name>` — Override the API job name for the follow-up publish job.
- `--source <source>` — Override the API source field. Default `scai`.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content publish history

Read the local publishing audit log at ~/.sitecoreai/audit.log (overridable via SITECOREAI\_AUDIT\_LOG). Filter by env / time / command / outcome. Use --json for newline-delimited JSON suitable for piping into jq.

```
scai content publish history [options]
```

**Options**

- `--env <name>` — Filter to entries from this env (matches scope.envName).
- `--since <spec>` — Filter to entries newer than this. ISO 8601 (e.g. 2026-05-01) or relative (24h, 7d, 30m).
- `--command <substr>` — Substring match against the `command` field (e.g. 'item', 'unpublish', 'content version').
- `--outcome <value>` — Filter by outcome.
- `--scan-limit <N>` — How many recent entries to scan before filtering (default 500). Increase for deep history searches.
- `--limit <N>` — Max entries to print after filtering (default 50).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai content workflow

Inspect and operate on Sitecore workflows — current state, available commands, transitions

```
scai content workflow [options] [command]
```

**Subcommands**

- [`scai content workflow get`](#scai-content-workflow-get) — Get an item's workflow assignment — current workflow, state, and the commands available from here
- [`scai content workflow commands`](#scai-content-workflow-commands) — List the workflow commands available on an item at its current state
- [`scai content workflow definitions`](#scai-content-workflow-definitions) — List workflow definitions on the tenant (walks /sitecore/system/Workflows by default)
- [`scai content workflow status`](#scai-content-workflow-status) — Show per-site workflow rollup — workflows on the site, their states, and page counts per state
- [`scai content workflow assigned`](#scai-content-workflow-assigned) — Find items currently in a given workflow state (workbox-style query)
- [`scai content workflow advance`](#scai-content-workflow-advance) — Advance a single item through one workflow transition (counterpart to the cleanup batch sweep)
- [`scai content workflow reset`](#scai-content-workflow-reset) — Force an item back to its workflow's initial state via direct \_\_Workflow state field write. Bypasses validation + submit actions — use as an admin escape hatch, not a routine transition.
- [`scai content workflow apply`](#scai-content-workflow-apply) — Attach a workflow to an item (sets \_\_Workflow + \_\_Workflow state directly). Bypasses the workflow engine — use for content authored before the workflow existed or to recover orphaned items.
- [`scai content workflow webhook`](#scai-content-workflow-webhook) — Manage Sitecore webhook handlers — item/publish event handlers and workflow submit/validation actions

#### scai content workflow get

Get an item's workflow assignment — current workflow, state, and the commands available from here

```
scai content workflow get [options] <item>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content workflow commands

List the workflow commands available on an item at its current state

```
scai content workflow commands [options] <item>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content workflow definitions

List workflow definitions on the tenant (walks /sitecore/system/Workflows by default)

```
scai content workflow definitions [options]
```

**Options**

- `--root <path>` — Override the workflows root path (default: /sitecore/system/Workflows)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content workflow status

Show per-site workflow rollup — workflows on the site, their states, and page counts per state

```
scai content workflow status [options]
```

**Options**

- `--site <siteId>` — Site identifier (GUID)
- `--content-environment-id <id>` — Optional Content Services environment ID (e.g. 'main')
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content workflow assigned

Find items currently in a given workflow state (workbox-style query)

```
scai content workflow assigned [options]
```

**Options**

- `--state <stateId>` — Workflow state GUID
- `--field <name>` — Override the search field (default: '\_\_workflow state'; some tenants use '\_\_workflow\_state')
- `--index <name>` — Override the search index (default: sitecore\_master\_index)
- `--limit <count>` — Cap on items returned (default: 500)
- `--page-size <count>` — Search backend page size (default: 100)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai content workflow advance

Advance a single item through one workflow transition (counterpart to the cleanup batch sweep)

```
scai content workflow advance [options] <item>
```

**Options**

- `--command <name>` — Workflow command display name (e.g. 'Submit', 'Approve'); matched case-insensitively against commands available at the item's current state
- `--comments <text>` — Comment recorded with the transition (audit trail)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config

#### scai content workflow reset

Force an item back to its workflow's initial state via direct \_\_Workflow state field write. Bypasses validation + submit actions — use as an admin escape hatch, not a routine transition.

```
scai content workflow reset [options] <item>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config

#### scai content workflow apply

Attach a workflow to an item (sets \_\_Workflow + \_\_Workflow state directly). Bypasses the workflow engine — use for content authored before the workflow existed or to recover orphaned items.

```
scai content workflow apply [options] <item>
```

**Options**

- `--workflow <ref>` — Workflow GUID, content-tree path, or display/item name (case-insensitive)
- `--state <ref>` — Override the target state (GUID or name). Defaults to the workflow's \_\_Initial state.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config

#### scai content workflow webhook

Manage Sitecore webhook handlers — item/publish event handlers and workflow submit/validation actions

```
scai content workflow webhook [options] [command]
```

**Subcommands**

- [`scai content workflow webhook list`](#scai-content-workflow-webhook-list) — List webhook handler items under the webhook tree
- [`scai content workflow webhook get`](#scai-content-workflow-webhook-get) — Get a webhook handler's URL, events, authorization, and other fields
- [`scai content workflow webhook events`](#scai-content-workflow-webhook-events) — List the event-type catalog the tenant accepts (the strings you pass to `--events` on `webhook create`)
- [`scai content workflow webhook create`](#scai-content-workflow-webhook-create) — Create a webhook handler — pick an event category and supply the URL + event names (or workflow state for workflow webhooks)
- [`scai content workflow webhook delete`](#scai-content-workflow-webhook-delete) — Delete a webhook handler by item ID or path

##### scai content workflow webhook list

List webhook handler items under the webhook tree

```
scai content workflow webhook list [options]
```

**Options**

- `--root <path>` — Override the content-tree root (default: /sitecore/system/Webhooks; for workflow webhooks pass a workflow state path)
- `--event-type <category>` — Filter by category: item \| publish \| workflow
- `--enabled-only` — Return only enabled handlers
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai content workflow webhook get

Get a webhook handler's URL, events, authorization, and other fields

```
scai content workflow webhook get [options] <webhook>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai content workflow webhook events

List the event-type catalog the tenant accepts (the strings you pass to `--events` on `webhook create`)

```
scai content workflow webhook events [options]
```

**Options**

- `--category <name>` — Limit to a single branch: item \| publish
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai content workflow webhook create

Create a webhook handler — pick an event category and supply the URL + event names (or workflow state for workflow webhooks)

```
scai content workflow webhook create [options]
```

**Options**

- `--name <name>` — Sitecore item name for the new handler
- `--url <url>` — Webhook target URL
- `--event <category>` — Event category: item \| publish \| workflow
- `--events <names>` — Event-type names for item/publish flavors (comma-separated or repeated). Examples: item:saved, item:deleted, publish:end (default: `[]`)
- `--on-state <path>` — Workflow state or command path (workflow flavor only). The action item is created at <on-state>/Actions/<name>.
- `--action <kind>` — Workflow action kind: submit (default, runs after transition) \| validation (synchronous gate)
- `--description <text>` — Optional description recorded on the handler
- `--authorization <path>` — Absolute path to an Authorization item under /sitecore/system/Settings/Webhooks/Authorizations
- `--serialization-type <type>` — Payload serialization: JSON (default) \| XML
- `--parent-path <path>` — Override parent path for item/publish handlers (default: /sitecore/system/Webhooks)
- `--disabled` — Create the handler disabled (default: enabled)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config

##### scai content workflow webhook delete

Delete a webhook handler by item ID or path

```
scai content workflow webhook delete [options] <webhook>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config

## scai ops

Sitecore Content Operations — briefs and campaigns

```
scai ops [options] [command]
```

**Subcommands**

- [`scai ops brief`](#scai-ops-brief) — [unstable] Briefs, brief types, to-dos, and comments on the Sitecore Content Operations Brief API.
- [`scai ops campaign`](#scai-ops-campaign) — [unstable] Sitecore Orchestrate campaigns — projects, deliverables, and tasks.

### scai ops brief

[unstable] Briefs, brief types, to-dos, and comments on the Sitecore Content Operations Brief API.

```
scai ops brief [options] [command]
```

**Subcommands**

- [`scai ops brief list`](#scai-ops-brief-list) — List briefs in the tenant.
- [`scai ops brief get`](#scai-ops-brief-get) — Get one brief by id, including its field values, tasks, and comments.
- [`scai ops brief create`](#scai-ops-brief-create) — Create a brief instance from a CreateBriefInput JSON document. For declarative + idempotent pushes, use `brief sync push --kind brief`.
- [`scai ops brief update`](#scai-ops-brief-update) — Update a brief instance with a partial-PUT body. Provide --file for arbitrary patches, or --status as a shortcut for a status-only move.
- [`scai ops brief delete`](#scai-ops-brief-delete) — Delete a brief. Requires --apply; non-TTY callers must also pass --force.
- [`scai ops brief types`](#scai-ops-brief-types) — Brief type operations (list, get, create, update, delete).
- [`scai ops brief sync`](#scai-ops-brief-sync) — Pull, diff, and push a brief type or brief instance as a declarative recipe.
- [`scai ops brief todos`](#scai-ops-brief-todos) — List to-dos across briefs, or filter to one brief with [briefId].
- [`scai ops brief comments`](#scai-ops-brief-comments) — Brief comment operations (list, add).

#### scai ops brief list

List briefs in the tenant.

```
scai ops brief list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--limit <n>` — Page size
- `--locale <code>` — Filter by locale (e.g. en-us)
- `--lean` — Emit only identity + linkage fields (id, name, status, locale, references) as compact JSON. Drops the heavy fields/tasks/comments bodies. --json only.

#### scai ops brief get

Get one brief by id, including its field values, tasks, and comments.

```
scai ops brief get [options] <briefId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai ops brief create

Create a brief instance from a CreateBriefInput JSON document. For declarative + idempotent pushes, use `brief sync push --kind brief`.

```
scai ops brief create [options]
```

**Options**

- `-f, --file <path>` — Path to a JSON file matching CreateBriefInput (name + briefTypeId, plus optional locale/fields/isTemplate).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops brief update

Update a brief instance with a partial-PUT body. Provide --file for arbitrary patches, or --status as a shortcut for a status-only move.

```
scai ops brief update [options] <briefId>
```

**Options**

- `-f, --file <path>` — Path to a JSON file with the partial patch.
- `--status <status>` — Shortcut: status-only patch. Equivalent to `scai ops brief set-status`.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops brief delete

Delete a brief. Requires --apply; non-TTY callers must also pass --force.

```
scai ops brief delete [options] <briefId>
```

**Options**

- `--force` — Skip TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops brief types

Brief type operations (list, get, create, update, delete).

```
scai ops brief types [options] [command]
```

**Subcommands**

- [`scai ops brief types list`](#scai-ops-brief-types-list) — List brief types — the schema templates that briefs are built against.
- [`scai ops brief types get`](#scai-ops-brief-types-get) — Read a single brief type by id.
- [`scai ops brief types create`](#scai-ops-brief-types-create) — Create a new brief type from a JSON document.
- [`scai ops brief types update`](#scai-ops-brief-types-update) — Replace a brief type via PUT (full-replacement). Read first if you only want to change one field.
- [`scai ops brief types delete`](#scai-ops-brief-types-delete) — Delete a brief type. Requires --apply; non-TTY callers must also pass --force.

##### scai ops brief types list

List brief types — the schema templates that briefs are built against.

```
scai ops brief types list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops brief types get

Read a single brief type by id.

```
scai ops brief types get [options] <briefTypeId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops brief types create

Create a new brief type from a JSON document.

```
scai ops brief types create [options]
```

**Options**

- `-f, --file <path>` — Path to a JSON file matching CreateBriefTypeInput
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

##### scai ops brief types update

Replace a brief type via PUT (full-replacement). Read first if you only want to change one field.

```
scai ops brief types update [options] <briefTypeId>
```

**Options**

- `-f, --file <path>` — Path to a JSON file matching CreateBriefTypeInput
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

##### scai ops brief types delete

Delete a brief type. Requires --apply; non-TTY callers must also pass --force.

```
scai ops brief types delete [options] <briefTypeId>
```

**Options**

- `--force` — Skip TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops brief sync

Pull, diff, and push a brief type or brief instance as a declarative recipe.

```
scai ops brief sync [options] [command]
```

**Subcommands**

- [`scai ops brief sync pull`](#scai-ops-brief-sync-pull) — Capture a live brief type or brief instance as a recipe file.
- [`scai ops brief sync diff`](#scai-ops-brief-sync-diff) — Show the plan to converge a brief type or brief onto a recipe file.
- [`scai ops brief sync push`](#scai-ops-brief-sync-push) — Converge a brief type or brief onto a recipe file. Dry-run unless --allow-write.

##### scai ops brief sync pull

Capture a live brief type or brief instance as a recipe file.

```
scai ops brief sync pull [options]
```

**Options**

- `--name <name>` — Identifier of the recipe. Brief-type codename (`Creative`) or brief display name (`Q3 Launch`).
- `--file <path>` — Output recipe file (default: <name>.<kind>.yaml)
- `--kind <kind>` — Recipe kind to operate on. Defaults to brief-type for back-compat. (default: `"brief-type"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops brief sync diff

Show the plan to converge a brief type or brief onto a recipe file.

```
scai ops brief sync diff [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `--kind <kind>` — Recipe kind to operate on. Defaults to brief-type for back-compat. (default: `"brief-type"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops brief sync push

Converge a brief type or brief onto a recipe file. Dry-run unless --allow-write.

```
scai ops brief sync push [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `--allow-write` — Apply the plan (default is a dry-run)
- `--prune` — Include delete changes (off by default)
- `--conflict-policy <policy>` — Three-way merge resolution when tenant-side edits diverge from baseline. `error` (default) refuses the push and surfaces the cells; `recipe-wins` clobbers tenant edits; `cms-wins` preserves them. Requires a baseline (HTTP storage via env or file-backed); without one, the kinds degrade to two-way diff and this flag has no effect.
- `--identities-out <path>` — Write the apply outcome's resolved Sitecore UUIDs (project, brief, deliverable, task) to a JSON file at this path. The orchestrator reads it back to persist UUIDs onto its own model so the next push can read entities by id directly — bypassing scai's marker-in-name / handle-label search.
- `--kind <kind>` — Recipe kind to operate on. Defaults to brief-type for back-compat. (default: `"brief-type"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai ops brief todos

List to-dos across briefs, or filter to one brief with [briefId].

```
scai ops brief todos [options] [briefId]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--assignees` — Expand assignee metadata
- `--limit <n>` — Page size

#### scai ops brief comments

Brief comment operations (list, add).

```
scai ops brief comments [options] [command]
```

**Subcommands**

- [`scai ops brief comments list`](#scai-ops-brief-comments-list) — List comments across briefs, or filter to one brief with [briefId].
- [`scai ops brief comments add`](#scai-ops-brief-comments-add) — Post a comment to a brief. Verified body shape: briefId + text + authorId; the server records `author` as the impersonated user while `createdBy` captures the actual caller. Requires --apply.

##### scai ops brief comments list

List comments across briefs, or filter to one brief with [briefId].

```
scai ops brief comments list [options] [briefId]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--limit <n>` — Page size

##### scai ops brief comments add

Post a comment to a brief. Verified body shape: briefId + text + authorId; the server records `author` as the impersonated user while `createdBy` captures the actual caller. Requires --apply.

```
scai ops brief comments add [options] <briefId>
```

**Options**

- `--text <text>` — Comment text
- `--author <authorId>` — Auth0 subject of the visible comment author (e.g. auth0\|abc123). Use `scai ops campaign users list` to enumerate.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

### scai ops campaign

[unstable] Sitecore Orchestrate campaigns — projects, deliverables, and tasks.

```
scai ops campaign [options] [command]
```

**Subcommands**

- [`scai ops campaign list`](#scai-ops-campaign-list) — List campaigns in the tenant.
- [`scai ops campaign get`](#scai-ops-campaign-get) — Get a campaign with its deliverables and tasks.
- [`scai ops campaign create`](#scai-ops-campaign-create) — Create a campaign. Requires --apply.
- [`scai ops campaign delete`](#scai-ops-campaign-delete) — Delete a campaign. UNVERIFIED — the Orchestrate DELETE endpoint was never captured; inferred from REST conventions. Requires --apply; non-TTY callers must also pass --force.
- [`scai ops campaign users`](#scai-ops-campaign-users) — List users available as campaign members / task assignees.
- [`scai ops campaign deliverable`](#scai-ops-campaign-deliverable) — Deliverable operations.
- [`scai ops campaign task`](#scai-ops-campaign-task) — Task operations.
- [`scai ops campaign sync`](#scai-ops-campaign-sync) — Pull, diff, and push a campaign as a declarative recipe.

#### scai ops campaign list

List campaigns in the tenant.

```
scai ops campaign list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--limit <n>` — Page size
- `--lean` — Emit only identity + linkage fields (id, name, labels, brandkit\_id, status) as compact JSON. Drops the heavy deliverables/members/attachments bodies. --json only.

#### scai ops campaign get

Get a campaign with its deliverables and tasks.

```
scai ops campaign get [options] <campaignId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai ops campaign create

Create a campaign. Requires --apply.

```
scai ops campaign create [options]
```

**Options**

- `--name <name>` — Campaign name
- `--description <text>` — Campaign description
- `--start-date <iso>` — Start date (ISO-8601)
- `--due-date <iso>` — Due date (ISO-8601)
- `--brandkit-id <id>` — Associated brand kit UUID
- `--status <status>` — Initial status (default: `"NOT_STARTED"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops campaign delete

Delete a campaign. UNVERIFIED — the Orchestrate DELETE endpoint was never captured; inferred from REST conventions. Requires --apply; non-TTY callers must also pass --force.

```
scai ops campaign delete [options] <campaignId>
```

**Options**

- `--force` — Skip TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops campaign users

List users available as campaign members / task assignees.

```
scai ops campaign users [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai ops campaign deliverable

Deliverable operations.

```
scai ops campaign deliverable [options] [command]
```

**Subcommands**

- [`scai ops campaign deliverable create`](#scai-ops-campaign-deliverable-create) — Create a deliverable under a campaign. Requires --apply.
- [`scai ops campaign deliverable delete`](#scai-ops-campaign-deliverable-delete) — Delete a deliverable under a campaign. UNVERIFIED — the Orchestrate DELETE endpoint was never captured; inferred from REST conventions. Requires --apply; non-TTY callers must also pass --force.

##### scai ops campaign deliverable create

Create a deliverable under a campaign. Requires --apply.

```
scai ops campaign deliverable create [options] <campaignId>
```

**Options**

- `--name <name>` — Deliverable name
- `--due-date <iso>` — Due date (ISO-8601)
- `--funnel-stage <stage>` — Funnel stage, e.g. TOP
- `--funnel-tactics <csv>` — Comma-separated funnel tactics
- `--status <status>` — Initial status (default: `"NOT_STARTED"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

##### scai ops campaign deliverable delete

Delete a deliverable under a campaign. UNVERIFIED — the Orchestrate DELETE endpoint was never captured; inferred from REST conventions. Requires --apply; non-TTY callers must also pass --force.

```
scai ops campaign deliverable delete [options] <campaignId> <deliverableId>
```

**Options**

- `--force` — Skip TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops campaign task

Task operations.

```
scai ops campaign task [options] [command]
```

**Subcommands**

- [`scai ops campaign task list`](#scai-ops-campaign-task-list) — List tasks under a deliverable.
- [`scai ops campaign task get`](#scai-ops-campaign-task-get) — Get one task.
- [`scai ops campaign task create`](#scai-ops-campaign-task-create) — Create a task under a deliverable. Requires --apply.
- [`scai ops campaign task update`](#scai-ops-campaign-task-update) — Replace a task via PUT (full-replacement). Requires --apply.
- [`scai ops campaign task delete`](#scai-ops-campaign-task-delete) — Delete a task under a deliverable. UNVERIFIED — the Orchestrate DELETE endpoint was never captured; inferred from REST conventions. Requires --apply; non-TTY callers must also pass --force.

##### scai ops campaign task list

List tasks under a deliverable.

```
scai ops campaign task list [options] <campaignId> <deliverableId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops campaign task get

Get one task.

```
scai ops campaign task get [options] <campaignId> <deliverableId> <taskId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops campaign task create

Create a task under a deliverable. Requires --apply.

```
scai ops campaign task create [options] <campaignId> <deliverableId>
```

**Options**

- `--name <name>` — Task name
- `--due-date <iso>` — Due date (ISO-8601)
- `--status <status>` — Initial status (default: `"NOT_STARTED"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

##### scai ops campaign task update

Replace a task via PUT (full-replacement). Requires --apply.

```
scai ops campaign task update [options] <campaignId> <deliverableId> <taskId>
```

**Options**

- `--name <name>` — Task name
- `--due-date <iso>` — Due date (ISO-8601)
- `--status <status>` — Status
- `--priority <priority>` — Priority
- `--description <html>` — Description (HTML)
- `--assignee <userId>` — Assignee — an Auth0 subject
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

##### scai ops campaign task delete

Delete a task under a deliverable. UNVERIFIED — the Orchestrate DELETE endpoint was never captured; inferred from REST conventions. Requires --apply; non-TTY callers must also pass --force.

```
scai ops campaign task delete [options] <campaignId> <deliverableId> <taskId>
```

**Options**

- `--force` — Skip TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--org-id <id>` — Sitecore organization id to act on. Overrides the env profile's organizationId.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai ops campaign sync

Pull, diff, and push a campaign as a declarative recipe.

```
scai ops campaign sync [options] [command]
```

**Subcommands**

- [`scai ops campaign sync pull`](#scai-ops-campaign-sync-pull) — Capture a live campaign as a recipe file.
- [`scai ops campaign sync diff`](#scai-ops-campaign-sync-diff) — Show the plan to converge a campaign onto a recipe file.
- [`scai ops campaign sync push`](#scai-ops-campaign-sync-push) — Converge a campaign onto a recipe file. Dry-run unless --allow-write.

##### scai ops campaign sync pull

Capture a live campaign as a recipe file.

```
scai ops campaign sync pull [options]
```

**Options**

- `--campaign <name>` — Campaign display name
- `--sitecore-id <uuid>` — Sitecore Orchestrate project UUID. When set, the read path loads the project by id and skips the display-name search — survives renames on either side. Pass the UUID stamped by a prior push (`--identities-out` writes it; the orchestrator persists it onto the recipe row).
- `--handle <handle>` — Stable campaign handle. When set, the read path matches the project by its `handle:` label so a renamed campaign still resolves even before a `sitecoreId` has been stamped. Falls back to display-name match when omitted.
- `--file <path>` — Output recipe file (default: <campaign>.campaign.yaml)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops campaign sync diff

Show the plan to converge a campaign onto a recipe file.

```
scai ops campaign sync diff [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai ops campaign sync push

Converge a campaign onto a recipe file. Dry-run unless --allow-write.

```
scai ops campaign sync push [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `--allow-write` — Apply the plan (default is a dry-run)
- `--prune` — Include delete changes (off by default)
- `--conflict-policy <policy>` — Three-way merge resolution when tenant-side edits diverge from baseline. `error` (default) refuses the push and surfaces the cells; `recipe-wins` clobbers tenant edits; `cms-wins` preserves them. Requires a baseline (HTTP storage via env or file-backed); without one, the kind degrades to two-way diff and this flag has no effect. Mirrors `scai ops brief sync push --conflict-policy`.
- `--identities-out <path>` — Write the apply outcome's resolved Sitecore UUIDs (project, deliverables, tasks) to a JSON file at this path. The orchestrator reads it back to persist UUIDs onto its own model so the next push can read entities by id directly.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai brand

[unstable] Sitecore brand surface (Brand Management + Brand Review). Provision the credential with `scai setup login brand`.

```
scai brand [options] [command]
```

**Subcommands**

- [`scai brand kits`](#scai-brand-kits) — Brand kit operations (list, get, sections, fields, create, publish, set-field, delete).
- [`scai brand docs`](#scai-brand-docs) — Brand document operations (upload, list, get, delete).
- [`scai brand ingest`](#scai-brand-ingest) — Trigger BrandIngestionPipeline — chunks the kit's documents.
- [`scai brand enrich`](#scai-brand-enrich) — Trigger EnrichSectionsPipeline — populates kit sections from already-ingested chunks.
- [`scai brand seed`](#scai-brand-seed) — Create a brand kit — from a PDF (--url, full ingest+enrich pipeline, ~5–15 min) or from a kit-shaped recipe file (--file, applied directly).
- [`scai brand review`](#scai-brand-review) — Evaluate file content against a Sitecore brand kit. Streams text, or aggregates into JSON / SARIF.
- [`scai brand sync`](#scai-brand-sync) — Pull, diff, and push a brand kit as a declarative recipe.

### scai brand kits

Brand kit operations (list, get, sections, fields, create, publish, set-field, delete).

```
scai brand kits [options] [command]
```

**Subcommands**

- [`scai brand kits list`](#scai-brand-kits-list) — List brand kits in the active organization.
- [`scai brand kits get`](#scai-brand-kits-get) — Retrieve a single brand kit by ID.
- [`scai brand kits sections`](#scai-brand-kits-sections) — List section names + IDs of a brand kit.
- [`scai brand kits fields`](#scai-brand-kits-fields) — List subsections (fields) within a section.
- [`scai brand kits create`](#scai-brand-kits-create) — Create a new brand kit. Lands in draft until published.
- [`scai brand kits publish`](#scai-brand-kits-publish) — Mark a brand kit as published. Required before pipelines populate sections.
- [`scai brand kits set-field`](#scai-brand-kits-set-field) — Directly write a brand kit subsection (field) value, bypassing the AI enrichment pipeline.
- [`scai brand kits delete`](#scai-brand-kits-delete) — Delete a brand kit. Destructive — requires --force or interactive confirmation.

#### scai brand kits list

List brand kits in the active organization.

```
scai brand kits list [options]
```

**Options**

- `--page-number <n>` — 1-based page number
- `--page-size <n>` — Items per page
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand kits get

Retrieve a single brand kit by ID.

```
scai brand kits get [options] <kitId>
```

**Options**

- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand kits sections

List section names + IDs of a brand kit.

```
scai brand kits sections [options] <kitId>
```

**Options**

- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand kits fields

List subsections (fields) within a section.

```
scai brand kits fields [options] <kitId> <sectionId>
```

**Options**

- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand kits create

Create a new brand kit. Lands in draft until published.

```
scai brand kits create [options] <name>
```

**Options**

- `--description <text>` — Human description
- `--industry <label>` — Industry label
- `--brand-name <name>` — Brand name (defaults to display name)
- `--company-name <name>` — Company name (if different)
- `--logo <url>` — PNG logo URL
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand kits publish

Mark a brand kit as published. Required before pipelines populate sections.

```
scai brand kits publish [options] <kitId>
```

**Options**

- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand kits set-field

Directly write a brand kit subsection (field) value, bypassing the AI enrichment pipeline.

```
scai brand kits set-field [options] <kitId> <sectionId> <fieldId>
```

**Options**

- `--value <text>` — Inline text value (for `text` fields)
- `--value-json <json>` — JSON-encoded value (for `array` / `richArray` fields)
- `--value-file <path>` — Read value text from this file
- `--verified` — Mark the field as operator-verified
- `--no-verified` — Clear the verified flag
- `--ai-editable` — Allow the enrichment pipeline to overwrite this field
- `--no-ai-editable` — Lock the field against pipeline overwrites
- `--intent <text>` — Update the AI-facing intent string
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand kits delete

Delete a brand kit. Destructive — requires --force or interactive confirmation.

```
scai brand kits delete [options] <kitId>
```

**Options**

- `-f, --force` — Skip the confirmation prompt
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

### scai brand docs

Brand document operations (upload, list, get, delete).

```
scai brand docs [options] [command]
```

**Subcommands**

- [`scai brand docs upload`](#scai-brand-docs-upload) — Upload a brand document to a kit by URL. Local-file upload is not supported — host the PDF and pass --url.
- [`scai brand docs list`](#scai-brand-docs-list) — List documents in the org, optionally filtered by kit or status.
- [`scai brand docs get`](#scai-brand-docs-get) — Retrieve a document by ID (useful for polling pipeline progress).
- [`scai brand docs delete`](#scai-brand-docs-delete) — Delete a document. Destructive — requires --force or confirmation.

#### scai brand docs upload

Upload a brand document to a kit by URL. Local-file upload is not supported — host the PDF and pass --url.

```
scai brand docs upload [options] <kitId> [file]
```

**Options**

- `--url <url>` — Public HTTPS URL to a PDF Sitecore's edge can reach
- `--title <text>` — Document title
- `--summary <text>` — Brief description
- `--type <label>` — Doc type tag (default: 'brand guidelines')
- `--mime <type>` — MIME type (default: application/pdf)
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand docs list

List documents in the org, optionally filtered by kit or status.

```
scai brand docs list [options]
```

**Options**

- `--kit <id>` — Filter to docs bound to this kit
- `--status <state>` — Filter by status
- `--page-number <n>` — 1-based page number
- `--page-size <n>` — Items per page
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand docs get

Retrieve a document by ID (useful for polling pipeline progress).

```
scai brand docs get [options] <docId>
```

**Options**

- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

#### scai brand docs delete

Delete a document. Destructive — requires --force or confirmation.

```
scai brand docs delete [options] <docId>
```

**Options**

- `-f, --force` — Skip the confirmation prompt
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

### scai brand ingest

Trigger BrandIngestionPipeline — chunks the kit's documents.

```
scai brand ingest [options] <kitId>
```

**Options**

- `--doc-ids <ids>` — Comma-separated document UUIDs (defaults to all unprocessed docs)
- `--no-populate-sections` — Skip auto-populating sections from chunks
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

### scai brand enrich

Trigger EnrichSectionsPipeline — populates kit sections from already-ingested chunks.

```
scai brand enrich [options] <kitId>
```

**Options**

- `--section-ids <ids>` — Comma-separated section UUIDs
- `--field-ids <ids>` — Comma-separated field UUIDs
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

### scai brand seed

Create a brand kit — from a PDF (--url, full ingest+enrich pipeline, ~5–15 min) or from a kit-shaped recipe file (--file, applied directly).

```
scai brand seed [options]
```

**Options**

- `--name <name>` — Display name for the new kit (required with --url)
- `--url <url>` — Public HTTPS URL to a PDF Sitecore's edge can reach
- `--file <path>` — Kit-shaped recipe file (.yaml / .json) — the `sync pull` shape
- `--description <text>` — Kit description (--url path only)
- `--industry <label>` — Industry label (--url path only)
- `--poll-interval-sec <n>` — Section poll interval in seconds (default 15)
- `--timeout-sec <n>` — Max seconds to wait for sections to populate (default 900 / 15min)
- `--format <kind>` — Output format (default: `"text"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override orgId from env profile

### scai brand review

Evaluate file content against a Sitecore brand kit. Streams text, or aggregates into JSON / SARIF.

```
scai brand review [options] [files...]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--org-id <id>` — Override the orgId resolved from the env profile.
- `--kit <id>` — Brand kit ID to evaluate against.
- `--section-id <id>` — Restrict to a section UUID (repeatable, comma-separated). Use <sectionId>:<fieldId> to narrow to a subsection. List section IDs with the Brand Management API.
- `--glob <pattern>` — Glob pattern(s) to expand
- `--threshold <score>` — Fail (exit 1) if any score is below this value (1–5).
- `--concurrency <n>` — Parallel in-flight reviews (default 4)
- `--fail-fast` — Stop scheduling on first failure (in-flight requests drain).
- `--format <kind>` — Output format (default: `"text"`)
- `--output <path>` — Write the report to this file instead of stdout.
- `--limit <n>` — Maximum files to review without --force (default 1000)
- `--force` — Bypass the --limit guardrail
- `--what-if` — Print the resolved file list + count and exit without calling the API.

### scai brand sync

Pull, diff, and push a brand kit as a declarative recipe.

```
scai brand sync [options] [command]
```

**Subcommands**

- [`scai brand sync pull`](#scai-brand-sync-pull) — Capture a live brand kit as a recipe file.
- [`scai brand sync diff`](#scai-brand-sync-diff) — Show the plan to converge a brand kit onto a recipe file.
- [`scai brand sync push`](#scai-brand-sync-push) — Converge a brand kit onto a recipe file. Dry-run unless --allow-write.

#### scai brand sync pull

Capture a live brand kit as a recipe file.

```
scai brand sync pull [options]
```

**Options**

- `--kit <name>` — Brand kit display name
- `--file <path>` — Output recipe file (default: <kit>.brandkit.yaml)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai brand sync diff

Show the plan to converge a brand kit onto a recipe file.

```
scai brand sync diff [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai brand sync push

Converge a brand kit onto a recipe file. Dry-run unless --allow-write.

```
scai brand sync push [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `--allow-write` — Apply the plan (default is a dry-run)
- `--prune` — Include delete changes (off by default)
- `--no-enrich` — Skip every code path that triggers a Sitecore AI enrichment pipeline run. Field PATCHes only — kit must already exist with the right section structure. Useful for fast iteration on field values without waiting 5-15 min for an enrichment cycle.
- `--conflict-policy <policy>` — Three-way merge resolution when tenant-side edits diverge from baseline. `error` (default) refuses the push and surfaces the cells; `recipe-wins` clobbers tenant edits; `cms-wins` preserves them and drops the recipe-side change for this push. Requires a baseline (HTTP storage via env or file-backed); without one, the brand kind degrades to two-way diff and this flag has no effect.
- `--identities-out <path>` — Write the apply outcome's resolved Sitecore brand-kit UUID to a JSON file at this path. The orchestrator reads it back to stamp the real UUID onto its brand\_kits row — without this the row stores the recipe handle as a placeholder and downstream campaign pushes can't populate `brandkit_id`.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai agents

[unstable] Sitecore Agentic Studio — agents, skills, tools, widgets, schemas, custom MCPs.

```
scai agents [options] [command]
```

**Subcommands**

- [`scai agents login`](#scai-agents-login) — Capture an Agentic Studio browser session for the environment (opens a browser).
- [`scai agents logout`](#scai-agents-logout) — Forget the stored Agentic Studio session.
- [`scai agents status`](#scai-agents-status) — Show the Agentic Studio session status.
- [`scai agents agent`](#scai-agents-agent) — Agentic Studio agents — full create / read / update / delete.
- [`scai agents space`](#scai-agents-space) — Agentic Studio spaces — the run container (read config + artifacts, update config).
- [`scai agents skill`](#scai-agents-skill) — Agentic Studio skills — reusable markdown guidance an agent attaches.
- [`scai agents widget`](#scai-agents-widget) — Agentic Studio widgets — configurable report/dashboard surfaces.
- [`scai agents schema`](#scai-agents-schema) — Agentic Studio structured-output schemas.
- [`scai agents mcp`](#scai-agents-mcp) — Registered custom MCP servers.
- [`scai agents html-template`](#scai-agents-html-template) — Agentic Studio HTML templates.
- [`scai agents tool`](#scai-agents-tool) — Agentic Studio tool catalog (read-only — no write path).
- [`scai agents sync`](#scai-agents-sync) — Pull, diff, and push Agentic Studio resources as declarative recipes.

### scai agents login

Capture an Agentic Studio browser session for the environment (opens a browser).

```
scai agents login [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--region <region>` — Agentic Studio region (default: resolved from the environment's organization)

### scai agents logout

Forget the stored Agentic Studio session.

```
scai agents logout [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai agents status

Show the Agentic Studio session status.

```
scai agents status [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai agents agent

Agentic Studio agents — full create / read / update / delete.

```
scai agents agent [options] [command]
```

**Subcommands**

- [`scai agents agent list`](#scai-agents-agent-list) — List agents.
- [`scai agents agent get`](#scai-agents-agent-get) — Show one agent.
- [`scai agents agent create`](#scai-agents-agent-create) — Create an agent from a recipe file.
- [`scai agents agent update`](#scai-agents-agent-update) — Update an agent from a recipe file (full-replacement of config).
- [`scai agents agent duplicate`](#scai-agents-agent-duplicate) — Duplicate an agent under a new name.
- [`scai agents agent delete`](#scai-agents-agent-delete) — Delete an agent. Requires --apply; non-TTY callers must also pass --force.
- [`scai agents agent run`](#scai-agents-agent-run) — Run an agent and stream its output.

#### scai agents agent list

List agents.

```
scai agents agent list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents agent get

Show one agent.

```
scai agents agent get [options] <idOrSlug>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents agent create

Create an agent from a recipe file.

```
scai agents agent create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a agent recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents agent update

Update an agent from a recipe file (full-replacement of config).

```
scai agents agent update [options] <idOrSlug>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a agent recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents agent duplicate

Duplicate an agent under a new name.

```
scai agents agent duplicate [options] <idOrSlug>
```

**Options**

- `--name <name>` — Name for the new agent
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents agent delete

Delete an agent. Requires --apply; non-TTY callers must also pass --force.

```
scai agents agent delete [options] <idOrSlug>
```

**Options**

- `--force` — Skip the TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents agent run

Run an agent and stream its output.

```
scai agents agent run [options] <agentSlug>
```

**Options**

- `-m, --message <text>` — Message to send to the agent
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai agents space

Agentic Studio spaces — the run container (read config + artifacts, update config).

```
scai agents space [options] [command]
```

**Subcommands**

- [`scai agents space get`](#scai-agents-space-get) — Show a space's config.
- [`scai agents space artifacts`](#scai-agents-space-artifacts) — Show a space's run artifacts — the structured output of its runs.
- [`scai agents space update`](#scai-agents-space-update) — Update a space's config — merges a JSON/YAML patch into the live config (rename via `spaceName`, change `agents` / `globalContext`).

#### scai agents space get

Show a space's config.

```
scai agents space get [options] <spaceId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents space artifacts

Show a space's run artifacts — the structured output of its runs.

```
scai agents space artifacts [options] <spaceId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents space update

Update a space's config — merges a JSON/YAML patch into the live config (rename via `spaceName`, change `agents` / `globalContext`).

```
scai agents space update [options] <spaceId>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a JSON/YAML patch — only the keys to change
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

### scai agents skill

Agentic Studio skills — reusable markdown guidance an agent attaches.

```
scai agents skill [options] [command]
```

**Subcommands**

- [`scai agents skill list`](#scai-agents-skill-list) — List skills.
- [`scai agents skill get`](#scai-agents-skill-get) — Show one skill.
- [`scai agents skill create`](#scai-agents-skill-create) — Create a skill from a recipe file.
- [`scai agents skill update`](#scai-agents-skill-update) — Update a skill from a recipe file.
- [`scai agents skill delete`](#scai-agents-skill-delete) — Delete a skill. Requires --apply; --force for non-TTY.

#### scai agents skill list

List skills.

```
scai agents skill list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents skill get

Show one skill.

```
scai agents skill get [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents skill create

Create a skill from a recipe file.

```
scai agents skill create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a skill recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents skill update

Update a skill from a recipe file.

```
scai agents skill update [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a skill recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents skill delete

Delete a skill. Requires --apply; --force for non-TTY.

```
scai agents skill delete [options] <idOrName>
```

**Options**

- `--force` — Skip the TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

### scai agents widget

Agentic Studio widgets — configurable report/dashboard surfaces.

```
scai agents widget [options] [command]
```

**Subcommands**

- [`scai agents widget list`](#scai-agents-widget-list) — List widgets.
- [`scai agents widget get`](#scai-agents-widget-get) — Show one widget.
- [`scai agents widget create`](#scai-agents-widget-create) — Create a widget from a recipe file.
- [`scai agents widget update`](#scai-agents-widget-update) — Update a widget from a recipe file.
- [`scai agents widget delete`](#scai-agents-widget-delete) — Delete a widget. Requires --apply; --force for non-TTY.

#### scai agents widget list

List widgets.

```
scai agents widget list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents widget get

Show one widget.

```
scai agents widget get [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents widget create

Create a widget from a recipe file.

```
scai agents widget create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a widget recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents widget update

Update a widget from a recipe file.

```
scai agents widget update [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a widget recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents widget delete

Delete a widget. Requires --apply; --force for non-TTY.

```
scai agents widget delete [options] <idOrName>
```

**Options**

- `--force` — Skip the TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

### scai agents schema

Agentic Studio structured-output schemas.

```
scai agents schema [options] [command]
```

**Subcommands**

- [`scai agents schema list`](#scai-agents-schema-list) — List schemas.
- [`scai agents schema get`](#scai-agents-schema-get) — Show one schema.
- [`scai agents schema create`](#scai-agents-schema-create) — Create a schema from a recipe file.
- [`scai agents schema update`](#scai-agents-schema-update) — Update a schema from a recipe file.
- [`scai agents schema delete`](#scai-agents-schema-delete) — Delete a schema. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md). Requires --apply; --force for non-TTY.

#### scai agents schema list

List schemas.

```
scai agents schema list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents schema get

Show one schema.

```
scai agents schema get [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents schema create

Create a schema from a recipe file.

```
scai agents schema create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a schema recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents schema update

Update a schema from a recipe file.

```
scai agents schema update [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a schema recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents schema delete

Delete a schema. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md). Requires --apply; --force for non-TTY.

```
scai agents schema delete [options] <idOrName>
```

**Options**

- `--force` — Skip the TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--unverified` — Attempt this UNVERIFIED write — its endpoint is not confirmed (see docs/agentic-studio-har-capture.md).
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

### scai agents mcp

Registered custom MCP servers.

```
scai agents mcp [options] [command]
```

**Subcommands**

- [`scai agents mcp list`](#scai-agents-mcp-list) — List mcps.
- [`scai agents mcp get`](#scai-agents-mcp-get) — Show one mcp.
- [`scai agents mcp create`](#scai-agents-mcp-create) — Create a mcp from a recipe file.
- [`scai agents mcp update`](#scai-agents-mcp-update) — Update a mcp from a recipe file. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md).
- [`scai agents mcp delete`](#scai-agents-mcp-delete) — Delete a mcp. Requires --apply; --force for non-TTY.

#### scai agents mcp list

List mcps.

```
scai agents mcp list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents mcp get

Show one mcp.

```
scai agents mcp get [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents mcp create

Create a mcp from a recipe file.

```
scai agents mcp create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a mcp recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents mcp update

Update a mcp from a recipe file. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md).

```
scai agents mcp update [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a mcp recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--unverified` — Attempt this UNVERIFIED write — its endpoint is not confirmed (see docs/agentic-studio-har-capture.md).
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents mcp delete

Delete a mcp. Requires --apply; --force for non-TTY.

```
scai agents mcp delete [options] <idOrName>
```

**Options**

- `--force` — Skip the TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

### scai agents html-template

Agentic Studio HTML templates.

```
scai agents html-template [options] [command]
```

**Subcommands**

- [`scai agents html-template list`](#scai-agents-html-template-list) — List html-templates.
- [`scai agents html-template get`](#scai-agents-html-template-get) — Show one html-template.
- [`scai agents html-template create`](#scai-agents-html-template-create) — Create a html-template from a recipe file.
- [`scai agents html-template update`](#scai-agents-html-template-update) — Update a html-template from a recipe file. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md).
- [`scai agents html-template delete`](#scai-agents-html-template-delete) — Delete a html-template. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md). Requires --apply; --force for non-TTY.

#### scai agents html-template list

List html-templates.

```
scai agents html-template list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents html-template get

Show one html-template.

```
scai agents html-template get [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents html-template create

Create a html-template from a recipe file.

```
scai agents html-template create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a html-template recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents html-template update

Update a html-template from a recipe file. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md).

```
scai agents html-template update [options] <idOrName>
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-f, --file <path>` — Path to a html-template recipe file (YAML or JSON) — same format as `scai agents sync`.
- `--unverified` — Attempt this UNVERIFIED write — its endpoint is not confirmed (see docs/agentic-studio-har-capture.md).
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

#### scai agents html-template delete

Delete a html-template. UNVERIFIED — requires --unverified (see docs/agentic-studio-har-capture.md). Requires --apply; --force for non-TTY.

```
scai agents html-template delete [options] <idOrName>
```

**Options**

- `--force` — Skip the TTY confirmation prompt (required for non-TTY agents).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--unverified` — Attempt this UNVERIFIED write — its endpoint is not confirmed (see docs/agentic-studio-har-capture.md).
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-w, --what-if` — Lists commands that would be executed, without executing them

### scai agents tool

Agentic Studio tool catalog (read-only — no write path).

```
scai agents tool [options] [command]
```

**Subcommands**

- [`scai agents tool list`](#scai-agents-tool-list) — List the tool catalog.

#### scai agents tool list

List the tool catalog.

```
scai agents tool list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai agents sync

Pull, diff, and push Agentic Studio resources as declarative recipes.

```
scai agents sync [options] [command]
```

**Subcommands**

- [`scai agents sync pull`](#scai-agents-sync-pull) — Capture a live Agentic Studio resource as a recipe file.
- [`scai agents sync diff`](#scai-agents-sync-diff) — Show the plan to converge a resource onto a recipe file.
- [`scai agents sync push`](#scai-agents-sync-push) — Converge a resource onto a recipe file. Dry-run unless --allow-write.

#### scai agents sync pull

Capture a live Agentic Studio resource as a recipe file.

```
scai agents sync pull [options]
```

**Options**

- `--name <name>` — Resource display name
- `--file <path>` — Output recipe file (default: <name>.<kind>.yaml)
- `--kind <kind>` — Recipe kind: agent \| skill \| widget \| custom-mcp \| schema \| html-template
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents sync diff

Show the plan to converge a resource onto a recipe file.

```
scai agents sync diff [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `--kind <kind>` — Recipe kind: agent \| skill \| widget \| custom-mcp \| schema \| html-template
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai agents sync push

Converge a resource onto a recipe file. Dry-run unless --allow-write.

```
scai agents sync push [options]
```

**Options**

- `--file <path>` — Recipe file (.yaml / .json)
- `--allow-write` — Apply the plan (default is a dry-run)
- `--kind <kind>` — Recipe kind: agent \| skill \| widget \| custom-mcp \| schema \| html-template
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai provision

Provision environments and content-as-code — deploy, serialization, recipes

```
scai provision [options] [command]
```

**Subcommands**

- [`scai provision deploy`](#scai-provision-deploy) — XM Cloud Deploy API commands
- [`scai provision serialization`](#scai-provision-serialization) — Item serialization commands
- [`scai provision recipe`](#scai-provision-recipe) — Compile, plan, and push declarative recipes to Sitecore

### scai provision deploy

XM Cloud Deploy API commands

```
scai provision deploy [options] [command]
```

**Subcommands**

- [`scai provision deploy deployments`](#scai-provision-deploy-deployments) — Deployment operations
- [`scai provision deploy editing-host`](#scai-provision-deploy-editing-host) — Editing host operations
- [`scai provision deploy environments`](#scai-provision-deploy-environments) — Environment operations
- [`scai provision deploy logs`](#scai-provision-deploy-logs) — Environment log files
- [`scai provision deploy organizations`](#scai-provision-deploy-organizations) — Organization operations
- [`scai provision deploy projects`](#scai-provision-deploy-projects) — Project operations
- [`scai provision deploy site`](#scai-provision-deploy-site) — SXA site operations
- [`scai provision deploy source-control`](#scai-provision-deploy-source-control) — Source control operations

#### scai provision deploy deployments

Deployment operations

**Aliases:** `dep`

```
scai provision deploy deployments [options] [command]
```

**Subcommands**

- [`scai provision deploy deployments cancel`](#scai-provision-deploy-deployments-cancel) — Cancel a deployment
- [`scai provision deploy deployments deploy`](#scai-provision-deploy-deployments-deploy) — Start a deployment
- [`scai provision deploy deployments get`](#scai-provision-deploy-deployments-get) — Get a deployment by ID
- [`scai provision deploy deployments list`](#scai-provision-deploy-deployments-list) — List deployments
- [`scai provision deploy deployments logs`](#scai-provision-deploy-deployments-logs) — Get deployment logs
- [`scai provision deploy deployments source`](#scai-provision-deploy-deployments-source) — Upload deployment source
- [`scai provision deploy deployments status`](#scai-provision-deploy-deployments-status) — Get deployment counts grouped by status
- [`scai provision deploy deployments watch`](#scai-provision-deploy-deployments-watch) — Watch deployment status

##### scai provision deploy deployments cancel

Cancel a deployment

```
scai provision deploy deployments cancel [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID

##### scai provision deploy deployments deploy

Start a deployment

```
scai provision deploy deployments deploy [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID

##### scai provision deploy deployments get

Get a deployment by ID

```
scai provision deploy deployments get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID

##### scai provision deploy deployments list

List deployments

```
scai provision deploy deployments list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--status <status>` — Filter by deployment status

##### scai provision deploy deployments logs

Get deployment logs

```
scai provision deploy deployments logs [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID
- `--output <path>` — Output file path

##### scai provision deploy deployments source

Upload deployment source

```
scai provision deploy deployments source [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID
- `--file <path>` — Path to source archive
- `--directory <path>` — Directory to zip and upload

##### scai provision deploy deployments status

Get deployment counts grouped by status

```
scai provision deploy deployments status [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy deployments watch

Watch deployment status

```
scai provision deploy deployments watch [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID
- `--wait-for-post-actions` — Wait for post-actions to complete
- `--timeout <seconds>` — Timeout in seconds before exiting watch

#### scai provision deploy editing-host

Editing host operations

**Aliases:** `eh`

```
scai provision deploy editing-host [options] [command]
```

**Subcommands**

- [`scai provision deploy editing-host create`](#scai-provision-deploy-editing-host-create) — Create an editing host environment
- [`scai provision deploy editing-host delete`](#scai-provision-deploy-editing-host-delete) — Delete an editing host environment
- [`scai provision deploy editing-host deploy`](#scai-provision-deploy-editing-host-deploy) — Deploy an editing host environment
- [`scai provision deploy editing-host list`](#scai-provision-deploy-editing-host-list) — List editing host environments
- [`scai provision deploy editing-host update`](#scai-provision-deploy-editing-host-update) — Update an editing host environment

##### scai provision deploy editing-host create

Create an editing host environment

```
scai provision deploy editing-host create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--cm-environment-id <id>` — CM environment ID
- `--name <name>` — Editing host name

##### scai provision deploy editing-host delete

Delete an editing host environment

```
scai provision deploy editing-host delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Editing host environment ID
- `--force` — Force delete environment

##### scai provision deploy editing-host deploy

Deploy an editing host environment

```
scai provision deploy editing-host deploy [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Editing host environment ID
- `--redeploy` — Deploy using the existing linked source code
- `--no-watch` — Do not watch deployment progress
- `--wait-for-post-actions` — Wait for post-actions to complete
- `--timeout <seconds>` — Timeout in seconds before exiting watch

##### scai provision deploy editing-host list

List editing host environments

```
scai provision deploy editing-host list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--project <value>` — Project name or ID (Deploy API)
- `--no-all` — Return only one page of environments before filtering (default: walk every page)
- `--page <n>` — 1-based page number; implies --no-all
- `--page-size <n>` — Page size. Defaults to 50 when walking, otherwise the API default (10).

##### scai provision deploy editing-host update

Update an editing host environment

```
scai provision deploy editing-host update [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Editing host environment ID
- `--name <name>` — Editing host name

#### scai provision deploy environments

Environment operations

**Aliases:** `env`

```
scai provision deploy environments [options] [command]
```

**Subcommands**

- [`scai provision deploy environments create`](#scai-provision-deploy-environments-create) — Create an environment
- [`scai provision deploy environments delete`](#scai-provision-deploy-environments-delete) — Delete an environment by name or ID
- [`scai provision deploy environments deployments`](#scai-provision-deploy-environments-deployments) — Environment deployments
- [`scai provision deploy environments get`](#scai-provision-deploy-environments-get) — Get an environment by name or ID
- [`scai provision deploy environments get-edge-token`](#scai-provision-deploy-environments-get-edge-token) — Get edge token for an environment
- [`scai provision deploy environments get-editing-secret`](#scai-provision-deploy-environments-get-editing-secret) — Get editing secret for an environment
- [`scai provision deploy environments health`](#scai-provision-deploy-environments-health) — Probe environment health (GET <cmHost>/healthz/ready)
- [`scai provision deploy environments limitation`](#scai-provision-deploy-environments-limitation) — Get environment limitations
- [`scai provision deploy environments link-repository`](#scai-provision-deploy-environments-link-repository) — Link a repository to an environment
- [`scai provision deploy environments list`](#scai-provision-deploy-environments-list) — List environments
- [`scai provision deploy environments promote`](#scai-provision-deploy-environments-promote) — Promote a deployment to this environment
- [`scai provision deploy environments regenerate-context`](#scai-provision-deploy-environments-regenerate-context) — Regenerate environment context
- [`scai provision deploy environments restart`](#scai-provision-deploy-environments-restart) — Restart an environment
- [`scai provision deploy environments unlink-repository`](#scai-provision-deploy-environments-unlink-repository) — Unlink a repository from an environment
- [`scai provision deploy environments variables`](#scai-provision-deploy-environments-variables) — Environment variables

##### scai provision deploy environments create

Create an environment

```
scai provision deploy environments create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--project <value>` — Project name or ID
- `--name <name>` — Environment name
- `--tenant-type <number>` — Tenant type (0 = nonprod, 1 = prod)
- `--cm-only` — Create a CM-only environment

##### scai provision deploy environments delete

Delete an environment by name or ID

```
scai provision deploy environments delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--force` — Force delete environment

##### scai provision deploy environments deployments

Environment deployments

```
scai provision deploy environments deployments [options] [command]
```

**Subcommands**

- [`scai provision deploy environments deployments create`](#scai-provision-deploy-environments-deployments-create) — Deploy to an environment
- [`scai provision deploy environments deployments list`](#scai-provision-deploy-environments-deployments-list) — List deployments for an environment

###### scai provision deploy environments deployments create

Deploy to an environment

```
scai provision deploy environments deployments create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--redeploy` — Deploy using the existing linked source code

###### scai provision deploy environments deployments list

List deployments for an environment

```
scai provision deploy environments deployments list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

##### scai provision deploy environments get

Get an environment by name or ID

```
scai provision deploy environments get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

##### scai provision deploy environments get-edge-token

Get edge token for an environment

```
scai provision deploy environments get-edge-token [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

##### scai provision deploy environments get-editing-secret

Get editing secret for an environment

```
scai provision deploy environments get-editing-secret [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

##### scai provision deploy environments health

Probe environment health (GET <cmHost>/healthz/ready)

```
scai provision deploy environments health [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

##### scai provision deploy environments limitation

Get environment limitations

```
scai provision deploy environments limitation [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy environments link-repository

Link a repository to an environment

```
scai provision deploy environments link-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--repository-name <name>` — Repository name
- `--repository-id <id>` — Repository ID
- `--integration-id <id>` — Integration ID
- `--repository-relative-path <path>` — Repository relative path
- `--repository-branch <name>` — Repository branch

##### scai provision deploy environments list

List environments

```
scai provision deploy environments list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--project <value>` — Project name or ID
- `--type <cm|eh>` — Filter by project type (cm or eh)
- `--all` — Walk every page and return the consolidated result set (default). Pass --no-all (or --page) to fetch a single page.
- `--page <n>` — 1-based page number. Implies --no-all and fetches a single page.
- `--page-size <n>` — Page size. Defaults to 50 when walking pages, otherwise the API default (10).

##### scai provision deploy environments promote

Promote a deployment to this environment

```
scai provision deploy environments promote [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--source-id <id>` — Source deployment ID
- `--no-start` — Do not start the promoted deployment
- `--no-watch` — Do not watch deployment progress
- `--wait-for-post-actions` — Wait for post-actions to complete
- `--timeout <seconds>` — Timeout in seconds before exiting watch

##### scai provision deploy environments regenerate-context

Regenerate environment context

```
scai provision deploy environments regenerate-context [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

##### scai provision deploy environments restart

Restart an environment

```
scai provision deploy environments restart [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--force` — Skip confirmation prompt
- `--status` — Get restart status instead of triggering a restart

##### scai provision deploy environments unlink-repository

Unlink a repository from an environment

```
scai provision deploy environments unlink-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

##### scai provision deploy environments variables

Environment variables

```
scai provision deploy environments variables [options] [command]
```

**Subcommands**

- [`scai provision deploy environments variables create`](#scai-provision-deploy-environments-variables-create) — Create or update an environment variable
- [`scai provision deploy environments variables delete`](#scai-provision-deploy-environments-variables-delete) — Delete an environment variable
- [`scai provision deploy environments variables list`](#scai-provision-deploy-environments-variables-list) — List environment variables

###### scai provision deploy environments variables create

Create or update an environment variable

```
scai provision deploy environments variables create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--variable <name>` — Variable name
- `--value <value>` — Variable value
- `--target <value>` — Variable target
- `--secret` — Store the variable as secret

###### scai provision deploy environments variables delete

Delete an environment variable

```
scai provision deploy environments variables delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--variable <name>` — Variable name

###### scai provision deploy environments variables list

List environment variables

```
scai provision deploy environments variables list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai provision deploy logs

Environment log files

**Aliases:** `log`

```
scai provision deploy logs [options] [command]
```

**Subcommands**

- [`scai provision deploy logs data`](#scai-provision-deploy-logs-data) — Download a log file
- [`scai provision deploy logs list`](#scai-provision-deploy-logs-list) — List environment log files
- [`scai provision deploy logs view`](#scai-provision-deploy-logs-view) — View a log file

##### scai provision deploy logs data

Download a log file

```
scai provision deploy logs data [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--log <filename>` — Log filename
- `--output <path>` — Output file path

##### scai provision deploy logs list

List environment log files

```
scai provision deploy logs list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--latest` — List only the latest logs

##### scai provision deploy logs view

View a log file

```
scai provision deploy logs view [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID
- `--log <filename>` — Log filename

#### scai provision deploy organizations

Organization operations

**Aliases:** `org`

```
scai provision deploy organizations [options] [command]
```

**Subcommands**

- [`scai provision deploy organizations get`](#scai-provision-deploy-organizations-get) — Get the current organization
- [`scai provision deploy organizations health`](#scai-provision-deploy-organizations-health) — Get organization health
- [`scai provision deploy organizations launch-demo`](#scai-provision-deploy-organizations-launch-demo) — Launch demo solution
- [`scai provision deploy organizations license`](#scai-provision-deploy-organizations-license) — Get organization license

##### scai provision deploy organizations get

Get the current organization

```
scai provision deploy organizations get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy organizations health

Get organization health

```
scai provision deploy organizations health [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy organizations launch-demo

Launch demo solution

```
scai provision deploy organizations launch-demo [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy organizations license

Get organization license

```
scai provision deploy organizations license [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision deploy projects

Project operations

**Aliases:** `proj`

```
scai provision deploy projects [options] [command]
```

**Subcommands**

- [`scai provision deploy projects create`](#scai-provision-deploy-projects-create) — Create a project
- [`scai provision deploy projects delete`](#scai-provision-deploy-projects-delete) — Delete a project by name or ID
- [`scai provision deploy projects get`](#scai-provision-deploy-projects-get) — Get a project by name or ID
- [`scai provision deploy projects limitation`](#scai-provision-deploy-projects-limitation) — Get project limitations
- [`scai provision deploy projects link-repository`](#scai-provision-deploy-projects-link-repository) — Link a repository to a project
- [`scai provision deploy projects list`](#scai-provision-deploy-projects-list) — List projects
- [`scai provision deploy projects unlink-repository`](#scai-provision-deploy-projects-unlink-repository) — Unlink a repository from a project
- [`scai provision deploy projects update`](#scai-provision-deploy-projects-update) — Update a project by name or ID
- [`scai provision deploy projects validate-name`](#scai-provision-deploy-projects-validate-name) — Validate that a project name is unique

##### scai provision deploy projects create

Create a project

```
scai provision deploy projects create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--name <name>` — Project name
- `--repository-name <name>` — Repository name
- `--repository-id <id>` — Repository ID
- `--source-control-integration-id <id>` — Source control integration ID (maps to integrationId)

##### scai provision deploy projects delete

Delete a project by name or ID

```
scai provision deploy projects delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID
- `--name <name>` — Project name
- `--force` — Skip confirmation prompt

##### scai provision deploy projects get

Get a project by name or ID

```
scai provision deploy projects get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID
- `--name <name>` — Project name

##### scai provision deploy projects limitation

Get project limitations

```
scai provision deploy projects limitation [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy projects link-repository

Link a repository to a project

```
scai provision deploy projects link-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID
- `--repository-name <name>` — Repository name
- `--repository-id <id>` — Repository ID
- `--integration-id <id>` — Integration ID
- `--repository-relative-path <path>` — Repository relative path

##### scai provision deploy projects list

List projects

```
scai provision deploy projects list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--all` — Fetch every page and return the consolidated result set (default: one page)
- `--page <n>` — 1-based page number (ignored with --all)
- `--page-size <n>` — Page size. Defaults to 50 with --all, otherwise the API default (10).

##### scai provision deploy projects unlink-repository

Unlink a repository from a project

```
scai provision deploy projects unlink-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID

##### scai provision deploy projects update

Update a project by name or ID

```
scai provision deploy projects update [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID
- `--name <name>` — Project name
- `--new-name <name>` — New project name
- `--repository-name <name>` — Repository name
- `--repository-id <id>` — Repository ID
- `--source-control-integration-id <id>` — Source control integration ID (maps to sourceControlIntegrationId)

##### scai provision deploy projects validate-name

Validate that a project name is unique

```
scai provision deploy projects validate-name [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--name <name>` — Project name

#### scai provision deploy site

SXA site operations

**Aliases:** `sites`

```
scai provision deploy site [options] [command]
```

**Subcommands**

- [`scai provision deploy site bind`](#scai-provision-deploy-site-bind) — Populate Site Grouping fields (HostName / StartItem / RenderingHost) so the site appears in Pages / Channels
- [`scai provision deploy site list`](#scai-provision-deploy-site-list) — List SXA sites in a CM environment

##### scai provision deploy site bind

Populate Site Grouping fields (HostName / StartItem / RenderingHost) so the site appears in Pages / Channels

```
scai provision deploy site bind [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--site-name <name>` — SXA site name (e.g. `e2e`)
- `--site-collection <name>` — SXA SiteCollection (Headless Tenant) the site lives under
- `--rendering-host-name <name>` — Override the RenderingHost item name. Default: --site-name.
- `--start-item-name <name>` — Start item name (relative to the site root). Default `Home`.
- `--host-name-pattern <value>` — HostName field value. Default `*` (wildcard).
- `--allow-write` — Apply changes (without it, the command runs in plan-only mode)

##### scai provision deploy site list

List SXA sites in a CM environment

**Aliases:** `ls`

```
scai provision deploy site list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--hostnames` — Resolve declared hostnames per site (adds an N+1 round trip per site)
- `--content-root <path>` — Override the content root walked. Default `/sitecore/content`.

#### scai provision deploy source-control

Source control operations

**Aliases:** `sc`

```
scai provision deploy source-control [options] [command]
```

**Subcommands**

- [`scai provision deploy source-control access-token`](#scai-provision-deploy-source-control-access-token) — Get source control integration access token
- [`scai provision deploy source-control delete`](#scai-provision-deploy-source-control-delete) — Delete a source control integration
- [`scai provision deploy source-control get`](#scai-provision-deploy-source-control-get) — Get a source control integration
- [`scai provision deploy source-control list`](#scai-provision-deploy-source-control-list) — List source control integrations
- [`scai provision deploy source-control providers`](#scai-provision-deploy-source-control-providers) — List source control providers
- [`scai provision deploy source-control repository`](#scai-provision-deploy-source-control-repository) — Source control repository operations
- [`scai provision deploy source-control state`](#scai-provision-deploy-source-control-state) — Get OAuth state for integration
- [`scai provision deploy source-control templates`](#scai-provision-deploy-source-control-templates) — List source control templates
- [`scai provision deploy source-control validate`](#scai-provision-deploy-source-control-validate) — Validate source control integration

##### scai provision deploy source-control access-token

Get source control integration access token

```
scai provision deploy source-control access-token [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

##### scai provision deploy source-control delete

Delete a source control integration

```
scai provision deploy source-control delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

##### scai provision deploy source-control get

Get a source control integration

```
scai provision deploy source-control get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

##### scai provision deploy source-control list

List source control integrations

```
scai provision deploy source-control list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy source-control providers

List source control providers

```
scai provision deploy source-control providers [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy source-control repository

Source control repository operations

```
scai provision deploy source-control repository [options] [command]
```

**Subcommands**

- [`scai provision deploy source-control repository branches`](#scai-provision-deploy-source-control-repository-branches) — List repository branches
- [`scai provision deploy source-control repository create-from-template`](#scai-provision-deploy-source-control-repository-create-from-template) — Create repository from template
- [`scai provision deploy source-control repository get`](#scai-provision-deploy-source-control-repository-get) — Get source control repository
- [`scai provision deploy source-control repository validate`](#scai-provision-deploy-source-control-repository-validate) — Validate source control repository

###### scai provision deploy source-control repository branches

List repository branches

```
scai provision deploy source-control repository branches [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--repository-name <name>` — Repository name
- `--integration-id <id>` — Integration ID

###### scai provision deploy source-control repository create-from-template

Create repository from template

```
scai provision deploy source-control repository create-from-template [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--provider <name>` — Provider (ado or github)
- `--template-repository <name>` — Template repository name
- `--template-owner <name>` — Template repository owner
- `--repository-name <name>` — Repository name
- `--owner <name>` — Repository owner
- `--integration-id <id>` — Integration ID
- `--description <text>` — Repository description
- `--private-repository` — Create a private repository
- `--no-private-repository` — Create a public repository
- `--include-all-branches` — Include all branches from template
- `--no-include-all-branches` — Exclude non-default branches

###### scai provision deploy source-control repository get

Get source control repository

```
scai provision deploy source-control repository get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--integration-id <id>` — Integration ID
- `--repository-id <id>` — Repository ID

###### scai provision deploy source-control repository validate

Validate source control repository

```
scai provision deploy source-control repository validate [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--integration-id <id>` — Integration ID
- `--repository-name <name>` — Repository name

##### scai provision deploy source-control state

Get OAuth state for integration

```
scai provision deploy source-control state [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision deploy source-control templates

List source control templates

```
scai provision deploy source-control templates [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--provider <name>` — Provider (ado or github)

##### scai provision deploy source-control validate

Validate source control integration

```
scai provision deploy source-control validate [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--apply` — Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set.
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

### scai provision serialization

Item serialization commands

**Aliases:** `ser`

```
scai provision serialization [options] [command]
```

**Subcommands**

- [`scai provision serialization diff`](#scai-provision-serialization-diff) — Compares two Sitecore instances
- [`scai provision serialization explain`](#scai-provision-serialization-explain) — Explains whether an item path is included and why
- [`scai provision serialization info`](#scai-provision-serialization-info) — Shows serialization configuration information
- [`scai provision serialization package`](#scai-provision-serialization-package) — Create or install packages of serialized items
- [`scai provision serialization pull`](#scai-provision-serialization-pull) — Pulls serialized items from Sitecore to disk
- [`scai provision serialization push`](#scai-provision-serialization-push) — Pushes serialized items from disk into Sitecore
- [`scai provision serialization validate`](#scai-provision-serialization-validate) — Checks serialized items for validity and can fix common issues
- [`scai provision serialization watch`](#scai-provision-serialization-watch) — Watches item changes in Sitecore and pulls them to disk

#### scai provision serialization diff

Compares two Sitecore instances

```
scai provision serialization diff [options]
```

**Options**

- `-s, --source <name>` — Named Sitecore endpoint to use as a source for comparison (alias: --source-env)
- `-d, --destination <name>` — Named Sitecore endpoint to use as a destination for comparison (alias: --target-env)
- `-p, --path <path>` — Item path to compare (instead of include/exclude)
- `--source-database <database>` — Source database (when used with --path)
- `--destination-database <database>` — Destination database (when used with --path)
- `--push` — Applies the differences detected to the destination (diff + push)
- `-w, --what-if` — With --push: builds the plan and prints it without writing to the destination
- `--allow-write` — With --push: allow writes to the destination for this invocation without updating config
- `--force` — With --push: skip the empty-source confirmation guard. Required if source has zero items.
- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision serialization explain

Explains whether an item path is included and why

```
scai provision serialization explain [options]
```

**Options**

- `-p, --path <path>` — Item path to explain
- `-d, --database <database>` — Database of the item path to explain (default: master)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision serialization info

Shows serialization configuration information

```
scai provision serialization info [options]
```

**Options**

- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision serialization package

Create or install packages of serialized items

**Aliases:** `pkg`

```
scai provision serialization package [options] [command]
```

**Subcommands**

- [`scai provision serialization package create`](#scai-provision-serialization-package-create) — Creates a new serialized item package
- [`scai provision serialization package install`](#scai-provision-serialization-package-install) — Install an existing item package to Sitecore

##### scai provision serialization package create

Creates a new serialized item package

```
scai provision serialization package create [options]
```

**Options**

- `-o, --output <path>` — Package path to output (will have extension added if not provided)
- `--overwrite` — Allow overwriting an existing package
- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

##### scai provision serialization package install

Install an existing item package to Sitecore

```
scai provision serialization package install [options]
```

**Options**

- `-f, --package <path>` — Package path to install from
- `--authority, --auth <url>` — Identity authority for the environment, i.e. identity server or AAD tenant URL
- `--cm <url>` — Sitecore content management hostname to connect to
- `--client-id <id>` — The OAuth ClientID to send. Defaults to 'Device' for device auth, and 'SitecoreCLIServer' for client credentials
- `--client-secret <secret>` — The OAuth client secret to send. Only used for client credentials authentication
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `-p, --publish` — Publish synced items. Not recommended to use with Publishing Service due to performance drop
- `--targets, --pt <value>` — Comma separated list of targets database to publish. Blank publishes to the default publishing target (first one in the list) (default: `[]`)

#### scai provision serialization pull

Pulls serialized items from Sitecore to disk

```
scai provision serialization pull [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--force` — Perform force sync. In case you have invalid includes
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision serialization push

Pushes serialized items from disk into Sitecore

```
scai provision serialization push [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--force` — Perform force sync. In case you have invalid includes
- `--allow-write` — Allow write operations for this command without updating config
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision serialization validate

Checks serialized items for validity and can fix common issues

```
scai provision serialization validate [options]
```

**Options**

- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-f, --fix` — Execute possible fix operations when validating the serialized items
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision serialization watch

Watches item changes in Sitecore and pulls them to disk

```
scai provision serialization watch [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-i, --include <value>` — Module configurations to include. Wildcards and multiple values are allowed (default: `[]`)
- `-e, --exclude <value>` — Module configurations to explicitly exclude. Wildcards and multiple values are allowed (default: `[]`)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai provision recipe

Compile, plan, and push declarative recipes to Sitecore

```
scai provision recipe [options] [command]
```

**Subcommands**

- [`scai provision recipe compile`](#scai-provision-recipe-compile) — Compile recipe (.ts/.json) files to Operation IR JSON files
- [`scai provision recipe diff`](#scai-provision-recipe-diff) — Show what `recipe push` would change — read-only diff against a tenant. Compiles recipes in-memory; never mutates.
- [`scai provision recipe plan`](#scai-provision-recipe-plan) — Plan an Operation IR push against a tenant — read-then-diff, no mutations
- [`scai provision recipe pull`](#scai-provision-recipe-pull) — Read tenant state and dump every reverse-projectable recipe to disk as .recipe.json. Read-only — does not mutate the tenant. Default snapshot mode dumps everything to <out>; `--against <recipes-dir>` enables three-way merge detection (in-sync / disk-ahead / tenant-edited / conflict).
- [`scai provision recipe push`](#scai-provision-recipe-push) — Apply recipes to a tenant. Compiles in-memory and runs the executor with idempotency + best-effort rollback.
- [`scai provision recipe prune-defaults`](#scai-provision-recipe-prune-defaults) — Remove the SXA Headless OOTB child folders under Available Renderings (Media, Navigation, Page Content, Page Structure), Headless Variants (Image, LinkList, Navigation, Page Content, Promo, Rich Text, Title), Data (Images, Link Lists, Navigation Filters, Promos, Texts — Tags is preserved), and Presentation/Styles (Spacing, Add Highlight, Content Alignment, Background Color, Background Layout, Navigation, Link List, Rich Text, Promo, Image, Common, Container). Keeps the parent folders. Idempotent — missing items are skipped, not errored.

#### scai provision recipe compile

Compile recipe (.ts/.json) files to Operation IR JSON files

```
scai provision recipe compile [options]
```

**Options**

- `-i, --input <path>` — Path to a recipe file. Defaults to the config `recipes` glob from sitecoreai.cli.json.
- `-o, --output <path>` — Path to write the output file
- `--templates-root <path>` — Sitecore parent path for template items. Falls back to envProfiles[<name>].templatesRoot.
- `--renderings-root <path>` — Sitecore parent path for rendering items. Falls back to envProfiles[<name>].renderingsRoot.
- `--components-root <path>` — Sitecore parent path for component template items in the per-site folder layout (Phase 2). Falls back to envProfiles[<name>].componentsRoot.
- `--content-models-root <path>` — Sitecore parent path for content-template items (Phase 2). Falls back to envProfiles[<name>].contentModelsRoot.
- `--partial-designs-root <path>` — Sitecore parent path for partial-design items (Phase 4). Falls back to envProfiles[<name>].partialDesignsRoot.
- `--page-designs-root <path>` — Sitecore parent path for page-design items (Phase 4). Falls back to envProfiles[<name>].pageDesignsRoot.
- `--content-items-root <path>` — Sitecore parent path for shared content items (Phase 4). Falls back to envProfiles[<name>].contentItemsRoot.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision recipe diff

Show what `recipe push` would change — read-only diff against a tenant. Compiles recipes in-memory; never mutates.

```
scai provision recipe diff [options]
```

**Options**

- `-i, --input <path>` — Path to a recipe file (.recipe.ts/.json) or pre-compiled .ir.json. Defaults to the config `recipes` glob from sitecoreai.cli.json.
- `--templates-root <path>` — Sitecore parent path for template items. Falls back to envProfiles[<name>].templatesRoot.
- `--renderings-root <path>` — Sitecore parent path for rendering items. Falls back to envProfiles[<name>].renderingsRoot.
- `--components-root <path>` — Sitecore parent path for component template items in the per-site folder layout (Phase 2). Falls back to envProfiles[<name>].componentsRoot.
- `--content-models-root <path>` — Sitecore parent path for content-template items (Phase 2). Falls back to envProfiles[<name>].contentModelsRoot.
- `--partial-designs-root <path>` — Sitecore parent path for partial-design items (Phase 4). Falls back to envProfiles[<name>].partialDesignsRoot.
- `--page-designs-root <path>` — Sitecore parent path for page-design items (Phase 4). Falls back to envProfiles[<name>].pageDesignsRoot.
- `--content-items-root <path>` — Sitecore parent path for shared content items (Phase 4). Falls back to envProfiles[<name>].contentItemsRoot.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision recipe plan

Plan an Operation IR push against a tenant — read-then-diff, no mutations

```
scai provision recipe plan [options]
```

**Options**

- `-i, --input <path>` — Path to a compiled .ir.json file
- `-o, --output <path>` — Path to write the output file
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `--snapshot-languages <list>` — Comma-separated ISO codes to capture in prune-rollback snapshots. When unset, auto-discovered via the Authoring API's tenant languages query. The first language becomes the inverse createItem language.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision recipe pull

Read tenant state and dump every reverse-projectable recipe to disk as .recipe.json. Read-only — does not mutate the tenant. Default snapshot mode dumps everything to <out>; `--against <recipes-dir>` enables three-way merge detection (in-sync / disk-ahead / tenant-edited / conflict).

```
scai provision recipe pull [options]
```

**Options**

- `-o, --output <path>` — Output directory. Defaults to ./pulled-recipes.
- `--against <recipes-dir>` — Path to authored recipes directory (or single recipe file). Enables merge-detection mode: compares the tenant projection against your local recipes + baseline and classifies each recipe. Use `--against .` to use the config glob from sitecoreai.cli.json.
- `--conflict-policy <policy>` — Merge-mode conflict policy (mirrors push's, direction-inverted). `error` (default) exits non-zero on tenant-edited / conflict; `disk-wins` skips writes for recipes with disk changes; `tenant-wins` writes every tenant projection regardless. Only used with --against. (default: `"error"`)
- `--no-baseline` — Skip three-way merge baseline loading. Without a baseline, any divergence classifies as conflict (we can't tell who moved).
- `--write-plan <path>` — Write a merge-plan JSON file with every per-recipe per-field classification + the default winner per --conflict-policy. Hand-editable: operator opens the file, flips `winner` to `disk` or `tenant` per field, then re-runs `recipe pull --apply-plan <same-path>` to commit. Implies merge mode (--against must be set).
- `--apply-plan <path>` — Read a merge-plan JSON file and use its `winner` picks per field instead of --conflict-policy. Pull rebuilds classifications + verifies the plan still matches the current tenant + disk state; refuses to apply a stale plan. Implies merge mode.
- `--dry-run` — Classify + report what WOULD be written without writing any files (no recipe JSON files, no merge plan). Useful in CI for verifying tenant + disk are in sync without leaving runner-FS artifacts.
- `--templates-root <path>` — Sitecore parent path for template items. Falls back to envProfiles[<name>].templatesRoot.
- `--renderings-root <path>` — Sitecore parent path for rendering items. Falls back to envProfiles[<name>].renderingsRoot.
- `--components-root <path>` — Sitecore parent path for component template items in the per-site folder layout (Phase 2). Falls back to envProfiles[<name>].componentsRoot.
- `--content-models-root <path>` — Sitecore parent path for content-template items (Phase 2). Falls back to envProfiles[<name>].contentModelsRoot.
- `--partial-designs-root <path>` — Sitecore parent path for partial-design items (Phase 4). Falls back to envProfiles[<name>].partialDesignsRoot.
- `--page-designs-root <path>` — Sitecore parent path for page-design items (Phase 4). Falls back to envProfiles[<name>].pageDesignsRoot.
- `--content-items-root <path>` — Sitecore parent path for shared content items (Phase 4). Falls back to envProfiles[<name>].contentItemsRoot.
- `--pages-root <path>` — Sitecore parent path for page items. Falls back to envProfiles[<name>].pagesRoot.
- `--enumerations-root <path>` — Sitecore parent path for enumeration containers. Falls back to envProfiles[<name>].enumerationsRoot.
- `--placeholder-settings-root <path>` — Sitecore parent path for Placeholder Settings items. Falls back to envProfiles[<name>].placeholderSettingsRoot.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision recipe push

Apply recipes to a tenant. Compiles in-memory and runs the executor with idempotency + best-effort rollback.

```
scai provision recipe push [options]
```

**Options**

- `-i, --input <path>` — Path to a recipe file (.recipe.ts/.json) or pre-compiled .ir.json. Defaults to the config `recipes` glob from sitecoreai.cli.json.
- `--templates-root <path>` — Sitecore parent path for template items. Falls back to envProfiles[<name>].templatesRoot.
- `--renderings-root <path>` — Sitecore parent path for rendering items. Falls back to envProfiles[<name>].renderingsRoot.
- `--components-root <path>` — Sitecore parent path for component template items in the per-site folder layout (Phase 2). Falls back to envProfiles[<name>].componentsRoot.
- `--content-models-root <path>` — Sitecore parent path for content-template items (Phase 2). Falls back to envProfiles[<name>].contentModelsRoot.
- `--partial-designs-root <path>` — Sitecore parent path for partial-design items (Phase 4). Falls back to envProfiles[<name>].partialDesignsRoot.
- `--page-designs-root <path>` — Sitecore parent path for page-design items (Phase 4). Falls back to envProfiles[<name>].pageDesignsRoot.
- `--content-items-root <path>` — Sitecore parent path for shared content items (Phase 4). Falls back to envProfiles[<name>].contentItemsRoot.
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config
- `--allow-prune` — Authorize deletion of items via PruneChildren ops with mode='delete'. Required IN ADDITION TO --apply when the IR contains delete-mode prunes.
- `--snapshot-languages <list>` — Comma-separated ISO codes to capture in prune-rollback snapshots. When unset, auto-discovered via the Authoring API's tenant languages query. The first language becomes the inverse createItem language.
- `--skip-unchanged-recipes` — Skip recipes whose compiled IR digest matches the cached entry from the previous successful push (.scai/recipe-cache.json). Off by default — opt in for fast re-pushes of an unchanged recipe set.
- `--plan-concurrency <n>` — Number of recipes plan-mode (--what-if) runs concurrently. Defaults to 4. Apply mode is always sequential per-recipe.
- `--conflict-policy <policy>` — Three-way merge resolution for tenant-side author edits since the last push. `error` (default) blocks the apply on any conflict; `recipe-wins` clobbers the author edit; `cms-wins` preserves it and drops the recipe-side change for this push. (default: `"error"`)
- `--no-baseline` — Skip three-way merge baseline loading + post-apply writing. Recipe becomes a legacy two-way diff (recipe-wins on every drift). Use for first-push test runs against a clean tenant or CI runs where the baseline isn't checked in.
- `--handles <list>` — Comma-separated list of recipe handles to narrow the push to. Cross-recipe references still resolve against the full input set; only matched handles are applied. Unknown handles are logged and ignored. Aligns with the `handles` field convention the orchestrator's brief/campaign sync plans use.
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai provision recipe prune-defaults

Remove the SXA Headless OOTB child folders under Available Renderings (Media, Navigation, Page Content, Page Structure), Headless Variants (Image, LinkList, Navigation, Page Content, Promo, Rich Text, Title), Data (Images, Link Lists, Navigation Filters, Promos, Texts — Tags is preserved), and Presentation/Styles (Spacing, Add Highlight, Content Alignment, Background Color, Background Layout, Navigation, Link List, Rich Text, Promo, Image, Common, Container). Keeps the parent folders. Idempotent — missing items are skipped, not errored.

```
scai provision recipe prune-defaults [options]
```

**Options**

- `--headless-variants-root <path>` — Override headlessVariantsRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Presentation/Headless Variants).
- `--available-renderings-root <path>` — Override availableRenderingsRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Presentation/Available Renderings).
- `--content-items-root <path>` — Override contentItemsRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Data).
- `--presentation-styles-root <path>` — Override presentationStylesRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Presentation/Styles).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai sync

Pull, diff, and push every brand kit and brief type at once — the cross-domain recipe aggregate.

```
scai sync [options] [command]
```

**Subcommands**

- [`scai sync pull`](#scai-sync-pull) — Enumerate every brand kit + brief type and capture each as a recipe file.
- [`scai sync status`](#scai-sync-status) — Diff every recipe file in the workspace against the environment.
- [`scai sync push`](#scai-sync-push) — Converge every recipe file in the workspace onto the environment. Dry-run unless --allow-write.

### scai sync pull

Enumerate every brand kit + brief type and capture each as a recipe file.

```
scai sync pull [options]
```

**Options**

- `--dir <path>` — Workspace directory for recipe files. (default: `".scai/sync"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai sync status

Diff every recipe file in the workspace against the environment.

```
scai sync status [options]
```

**Options**

- `--dir <path>` — Workspace directory for recipe files. (default: `".scai/sync"`)
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai sync push

Converge every recipe file in the workspace onto the environment. Dry-run unless --allow-write.

```
scai sync push [options]
```

**Options**

- `--dir <path>` — Workspace directory for recipe files. (default: `".scai/sync"`)
- `--allow-write` — Apply the plan (default is a dry-run).
- `--prune` — Include delete changes (off by default).
- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai mcp

Model Context Protocol — run an MCP server exposing scai's developer-side surface to agents.

```
scai mcp [options] [command]
```

**Subcommands**

- [`scai mcp serve`](#scai-mcp-serve) — Launch the scai MCP server (stdio or Streamable HTTP) bound to one environment.
- [`scai mcp tools`](#scai-mcp-tools) — Inspect the scai MCP tool surface (offline).

### scai mcp serve

Launch the scai MCP server (stdio or Streamable HTTP) bound to one environment.

```
scai mcp serve [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (defaults to defaultEnvProfile).
- `-c, --config <path>` — Path to sitecoreai.cli.json or a directory containing one.
- `--transport <kind>` — Transport: 'stdio' (default) or 'http' (Streamable HTTP). (default: `"stdio"`)
- `--port <number>` — HTTP transport port (only used with --transport http). (default: `3399`)
- `--host <address>` — HTTP transport bind address (only used with --transport http). (default: `"127.0.0.1"`)
- `--no-telemetry` — Disable telemetry for this MCP session. Telemetry is enabled by default; the DO\_NOT\_TRACK env var is still honored.

### scai mcp tools

Inspect the scai MCP tool surface (offline).

```
scai mcp tools [options] [command]
```

**Subcommands**

- [`scai mcp tools list`](#scai-mcp-tools-list) — List every registered tool with its description and auth class.
- [`scai mcp tools schema`](#scai-mcp-tools-schema) — Print the Zod-derived JSON schema for one tool (--name) or all tools.

#### scai mcp tools list

List every registered tool with its description and auth class.

```
scai mcp tools list [options]
```

**Options**

- `--json` — Emit JSON instead of TSV.
- `--names` — List tool names only — one per line, no auth or description.

#### scai mcp tools schema

Print the Zod-derived JSON schema for one tool (--name) or all tools.

```
scai mcp tools schema [options]
```

**Options**

- `--name <name>` — Tool name. When omitted, returns every tool's schema.
- `--json` — Emit JSON (always JSON for schema output; flag retained for parity).

## scai cli

CLI tooling — config, diagnostics, history, REPL

```
scai cli [options] [command]
```

**Subcommands**

- [`scai cli config`](#scai-cli-config) — Configuration utilities
- [`scai cli health`](#scai-cli-health) — Show health of every environment in the active tenant
- [`scai cli history`](#scai-cli-history) — Show CLI activity history
- [`scai cli shell`](#scai-cli-shell) — Start an interactive shell
- [`scai cli telemetry`](#scai-cli-telemetry) — Telemetry utilities
- [`scai cli topics`](#scai-cli-topics) — Show scai commands grouped by intent (e.g. 'diagnose-blocked-delete') instead of alphabetically

### scai cli config

Configuration utilities

```
scai cli config [options] [command]
```

**Subcommands**

- [`scai cli config validate`](#scai-cli-config-validate) — Validate sitecoreai.cli.json

#### scai cli config validate

Validate sitecoreai.cli.json

```
scai cli config validate [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai cli health

Show health of every environment in the active tenant

```
scai cli health [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--project <value>` — Filter to environments in this project
- `--type <cm|eh>` — Filter by environment type
- `--no-probe` — List status only — skip per-env probes
- `--concurrency <n>` — Probe concurrency (default 8)

### scai cli history

Show CLI activity history

```
scai cli history [options]
```

**Options**

- `--path <path>` — History log path override
- `--limit <number>` — Number of entries to show
- `--raw` — Print raw JSON lines
- `--reverse` — Show newest entries first
- `--show-path` — Show the history log path and exit
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai cli shell

Start an interactive shell

```
scai cli shell [options]
```

### scai cli telemetry

Telemetry utilities

```
scai cli telemetry [options] [command]
```

**Subcommands**

- [`scai cli telemetry status`](#scai-cli-telemetry-status) — Show telemetry status
- [`scai cli telemetry enable`](#scai-cli-telemetry-enable) — Enable anonymous usage telemetry
- [`scai cli telemetry disable`](#scai-cli-telemetry-disable) — Disable anonymous usage telemetry

#### scai cli telemetry status

Show telemetry status

```
scai cli telemetry status [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai cli telemetry enable

Enable anonymous usage telemetry

```
scai cli telemetry enable [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai cli telemetry disable

Disable anonymous usage telemetry

```
scai cli telemetry disable [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai cli topics

Show scai commands grouped by intent (e.g. 'diagnose-blocked-delete') instead of alphabetically

```
scai cli topics [options] [command]
```

**Options**

- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

**Subcommands**

- [`scai cli topics list`](#scai-cli-topics-list) — List every topic with its one-line summary.
- [`scai cli topics show`](#scai-cli-topics-show) — Expand one topic into its recommended-run command sequence.

#### scai cli topics list

List every topic with its one-line summary.

```
scai cli topics list [options]
```

**Options**

- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai cli topics show

Expand one topic into its recommended-run command sequence.

```
scai cli topics show [options] <name>
```

**Options**

- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
