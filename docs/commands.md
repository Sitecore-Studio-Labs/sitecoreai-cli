<!-- AUTO-GENERATED: do not edit by hand. Run `pnpm docs:commands` to refresh. -->

# Command reference

Generated from the Commander tree in `src/commands/` at scai v0.0.4.
The canonical source is always `scai <command> --help`; this file is for browsing on GitHub or in IDEs.

## scai

SitecoreAI Deploy & Sync CLI for serialization and deploy workflows

**Top-level commands**

- [`audit`](#scai-audit) — Read-only diagnostics over Sitecore content — links, media, archive, workflow, languages, templates, datasources, duplicates, empty items, page designs, personalization
- [`cleanup`](#scai-cleanup) — Mutating hygiene operations — versions, archive, templates, duplicates, find-replace, workflow, folders, roles, users. Honours --what-if and --allow-write.
- [`config`](#scai-config) — Configuration utilities
- [`deploy`](#scai-deploy) — XM Cloud Deploy API commands
- [`history`](#scai-history) — Show CLI activity history
- [`init`](#scai-init) — Create or update an environment with project selection and SitecoreAI credentials
- [`login`](#scai-login) — Authenticate with SitecoreAI and store an access token (Deploy + CM/admin scopes)
- [`logout`](#scai-logout) — Clear stored authentication tokens
- [`serialization`](#scai-serialization) — Item serialization commands
- [`status`](#scai-status) — Show configured Sitecore environments for this CLI
- [`telemetry`](#scai-telemetry) — Telemetry utilities

## scai audit

Read-only diagnostics over Sitecore content — links, media, archive, workflow, languages, templates, datasources, duplicates, empty items, page designs, personalization

```
scai audit [options] [command]
```

**Subcommands**

- [`scai audit all`](#scai-audit-all) — Run every audit and emit a consolidated report (skip find-replace; it needs --pattern)
- [`scai audit alt-text-missing`](#scai-audit-alt-text-missing) — Find Image-field values with empty alt text (accessibility audit)
- [`scai audit baseline`](#scai-audit-baseline) — Manage the per-env audit baseline (ignore-list of accepted findings)
- [`scai audit broken-images`](#scai-audit-broken-images) — Find <img src> URLs in RichText fields that fail HTTP HEAD (404, timeout, network)
- [`scai audit broken-links`](#scai-audit-broken-links) — Find content items with internal links that point to deleted items
- [`scai audit heavy-templates`](#scai-audit-heavy-templates) — Find templates with more than N fields (slow editor + brittle fixtures)
- [`scai audit large-fields`](#scai-audit-large-fields) — Find content items with field values exceeding a byte-size threshold
- [`scai audit missing-meta`](#scai-audit-missing-meta) — Find items missing required (SEO) field values
- [`scai audit datasource-missing`](#scai-audit-datasource-missing) — Find page items with rendering datasources that don't resolve
- [`scai audit dead-templates`](#scai-audit-dead-templates) — Find item templates with zero items derived from them
- [`scai audit duplicates`](#scai-audit-duplicates) — Find items with byte-identical authored content
- [`scai audit empty-items`](#scai-audit-empty-items) — Find items with no authored field values
- [`scai audit empty-links`](#scai-audit-empty-links) — Find General Link / CTA fields that are structurally empty (link goes nowhere)
- [`scai audit empty-roles`](#scai-audit-empty-roles) — Find roles with zero direct members
- [`scai audit fallback-drift`](#scai-audit-fallback-drift) — Find items where target-language versions lag the reference language by N days
- [`scai audit find-replace`](#scai-audit-find-replace) — Search content field values for a pattern (regex or literal). Read-only counterpart to `cleanup find-replace`.
- [`scai audit language-data`](#scai-audit-language-data) — Find items with empty per-language entries (no versions) — read-only diagnostic
- [`scai audit orphans`](#scai-audit-orphans) — Find items in the Sitecore archive (recycle bin) — the XM Cloud analogue of orphan items
- [`scai audit page-design-orphans`](#scai-audit-page-design-orphans) — Find pages referencing missing page designs (XM Cloud SXA)
- [`scai audit personalization-broken`](#scai-audit-personalization-broken) — Find pages with personalization rules referencing missing items
- [`scai audit references`](#scai-audit-references) — Find every item with a field that references a target item — generic inbound-reference scan
- [`scai audit role-bloat`](#scai-audit-role-bloat) — Find users with more than N role memberships (default 10)
- [`scai audit site-residue`](#scai-audit-site-residue) — Find SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)
- [`scai audit slug-conflicts`](#scai-audit-slug-conflicts) — Find siblings sharing the same item name (URL conflict)
- [`scai audit stale-content`](#scai-audit-stale-content) — Find content items not updated in N days — the abandoned-content (graveyard) signal
- [`scai audit stale-users`](#scai-audit-stale-users) — Find users inactive for N days (default 180)
- [`scai audit stale-workflow`](#scai-audit-stale-workflow) — Find items stuck in a workflow state past a stale-after threshold
- [`scai audit template-dependencies`](#scai-audit-template-dependencies) — List every item that references a given template — primary template, base template, insert options, or branch source
- [`scai audit history`](#scai-audit-history) — Snapshot audit-all results over time + diff across snapshots
- [`scai audit suite`](#scai-audit-suite) — Run a YAML-defined audit pipeline (codified hygiene policy)
- [`scai audit translation-coverage`](#scai-audit-translation-coverage) — Measure translation coverage between a reference and target language(s)
- [`scai audit unused-media`](#scai-audit-unused-media) — Find media library items with zero references from content

### scai audit all

Run every audit and emit a consolidated report (skip find-replace; it needs --pattern)

```
scai audit all [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit alt-text-missing

Find Image-field values with empty alt text (accessibility audit)

```
scai audit alt-text-missing [options] [command]
```

**Subcommands**

- [`scai audit alt-text-missing list`](#scai-audit-alt-text-missing-list) — List items whose Image fields have empty or missing alt attribute

#### scai audit alt-text-missing list

List items whose Image fields have empty or missing alt attribute

```
scai audit alt-text-missing list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language

### scai audit baseline

Manage the per-env audit baseline (ignore-list of accepted findings)

```
scai audit baseline [options] [command]
```

**Subcommands**

- [`scai audit baseline show`](#scai-audit-baseline-show) — Print the current baseline contents
- [`scai audit baseline create`](#scai-audit-baseline-create) — Run audits and add every current finding to the baseline (accept-all snapshot)
- [`scai audit baseline remove`](#scai-audit-baseline-remove) — Remove a single entry from the baseline
- [`scai audit baseline reset`](#scai-audit-baseline-reset) — Wipe the baseline for one audit (or all audits if --audit is omitted)

#### scai audit baseline show

Print the current baseline contents

```
scai audit baseline show [options]
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

#### scai audit baseline create

Run audits and add every current finding to the baseline (accept-all snapshot)

```
scai audit baseline create [options]
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

#### scai audit baseline remove

Remove a single entry from the baseline

```
scai audit baseline remove [options]
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

#### scai audit baseline reset

Wipe the baseline for one audit (or all audits if --audit is omitted)

```
scai audit baseline reset [options]
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

### scai audit broken-images

Find <img src> URLs in RichText fields that fail HTTP HEAD (404, timeout, network)

```
scai audit broken-images [options] [command]
```

**Subcommands**

- [`scai audit broken-images list`](#scai-audit-broken-images-list) — Probe each <img> URL with HEAD and report non-2xx / timeouts

#### scai audit broken-images list

Probe each <img> URL with HEAD and report non-2xx / timeouts

```
scai audit broken-images list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit broken-links

Find content items with internal links that point to deleted items

```
scai audit broken-links [options] [command]
```

**Subcommands**

- [`scai audit broken-links list`](#scai-audit-broken-links-list) — List items containing broken internal links (RichText, General Link, Multilist)

#### scai audit broken-links list

List items containing broken internal links (RichText, General Link, Multilist)

```
scai audit broken-links list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)

### scai audit heavy-templates

Find templates with more than N fields (slow editor + brittle fixtures)

```
scai audit heavy-templates [options] [command]
```

**Subcommands**

- [`scai audit heavy-templates list`](#scai-audit-heavy-templates-list) — List templates with field count >= --threshold (default 50)

#### scai audit heavy-templates list

List templates with field count >= --threshold (default 50)

```
scai audit heavy-templates list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Template-tree root (default: /sitecore/templates)
- `--threshold <count>` — Field-count threshold (default 50)

### scai audit large-fields

Find content items with field values exceeding a byte-size threshold

```
scai audit large-fields [options] [command]
```

**Subcommands**

- [`scai audit large-fields list`](#scai-audit-large-fields-list) — List items whose individual field values are >= --threshold bytes (default 100KB)

#### scai audit large-fields list

List items whose individual field values are >= --threshold bytes (default 100KB)

```
scai audit large-fields list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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
- `--include-system-fields` — Include __-prefixed system fields in the size check

### scai audit missing-meta

Find items missing required (SEO) field values

```
scai audit missing-meta [options] [command]
```

**Subcommands**

- [`scai audit missing-meta list`](#scai-audit-missing-meta-list) — List items lacking any of the required fields (default SEO set)

#### scai audit missing-meta list

List items lacking any of the required fields (default SEO set)

```
scai audit missing-meta list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit datasource-missing

Find page items with rendering datasources that don't resolve

```
scai audit datasource-missing [options] [command]
```

**Subcommands**

- [`scai audit datasource-missing list`](#scai-audit-datasource-missing-list) — List items whose __Renderings / __Final Renderings reference missing datasources

#### scai audit datasource-missing list

List items whose __Renderings / __Final Renderings reference missing datasources

```
scai audit datasource-missing list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--report-query-datasources` — Also report Sitecore query: and local: datasources (which can't be resolved statically)

### scai audit dead-templates

Find item templates with zero items derived from them

```
scai audit dead-templates [options] [command]
```

**Subcommands**

- [`scai audit dead-templates list`](#scai-audit-dead-templates-list) — List unused item templates

#### scai audit dead-templates list

List unused item templates

```
scai audit dead-templates list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Template-tree root to scan (default: /sitecore/templates)

### scai audit duplicates

Find items with byte-identical authored content

```
scai audit duplicates [options] [command]
```

**Subcommands**

- [`scai audit duplicates list`](#scai-audit-duplicates-list) — List duplicate-content groups (>= 2 members each, by default)

#### scai audit duplicates list

List duplicate-content groups (>= 2 members each, by default)

```
scai audit duplicates list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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
- `--include-system-fields` — Include __-prefixed system fields when computing the content hash (off by default to ignore per-item metadata)

### scai audit empty-items

Find items with no authored field values

```
scai audit empty-items [options] [command]
```

**Subcommands**

- [`scai audit empty-items list`](#scai-audit-empty-items-list) — List items where every non-system field is empty or whitespace

#### scai audit empty-items list

List items where every non-system field is empty or whitespace

```
scai audit empty-items list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--language <code>` — Restrict to one language (default: include all)

### scai audit empty-links

Find General Link / CTA fields that are structurally empty (link goes nowhere)

```
scai audit empty-links [options] [command]
```

**Subcommands**

- [`scai audit empty-links list`](#scai-audit-empty-links-list) — List items whose Link fields have no target (the visible button, the invisible href)

#### scai audit empty-links list

List items whose Link fields have no target (the visible button, the invisible href)

```
scai audit empty-links list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit empty-roles

Find roles with zero direct members

```
scai audit empty-roles [options] [command]
```

**Subcommands**

- [`scai audit empty-roles list`](#scai-audit-empty-roles-list) — List roles whose members(first:1) returns an empty connection

#### scai audit empty-roles list

List roles whose members(first:1) returns an empty connection

```
scai audit empty-roles list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--domain <name>` — Restrict to a specific domain (e.g. sitecore, extranet)

### scai audit fallback-drift

Find items where target-language versions lag the reference language by N days

```
scai audit fallback-drift [options] [command]
```

**Subcommands**

- [`scai audit fallback-drift list`](#scai-audit-fallback-drift-list) — Compare updatedDate between --reference-language and --target-language versions

#### scai audit fallback-drift list

Compare updatedDate between --reference-language and --target-language versions

```
scai audit fallback-drift list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit find-replace

Search content field values for a pattern (regex or literal). Read-only counterpart to `cleanup find-replace`.

```
scai audit find-replace [options] [command]
```

**Subcommands**

- [`scai audit find-replace list`](#scai-audit-find-replace-list) — List items whose fields contain matches for --pattern

#### scai audit find-replace list

List items whose fields contain matches for --pattern

```
scai audit find-replace list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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
- `--include-system-fields` — Include __-prefixed system fields in the search (off by default)
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--max-matches-per-item <count>` — Maximum number of sample snippets captured per matching item (default 10)

### scai audit language-data

Find items with empty per-language entries (no versions) — read-only diagnostic

```
scai audit language-data [options] [command]
```

**Subcommands**

- [`scai audit language-data list`](#scai-audit-language-data-list) — List (item, language) pairs where the language entry exists but has zero versions

#### scai audit language-data list

List (item, language) pairs where the language entry exists but has zero versions

```
scai audit language-data list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--languages <value>` — Comma-separated language codes to inspect (default: all languages found under --root) (default: `[]`)

### scai audit orphans

Find items in the Sitecore archive (recycle bin) — the XM Cloud analogue of orphan items

```
scai audit orphans [options] [command]
```

**Subcommands**

- [`scai audit orphans list`](#scai-audit-orphans-list) — List archived (orphan) items

#### scai audit orphans list

List archived (orphan) items

```
scai audit orphans list [options]
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

### scai audit page-design-orphans

Find pages referencing missing page designs (XM Cloud SXA)

```
scai audit page-design-orphans [options] [command]
```

**Subcommands**

- [`scai audit page-design-orphans list`](#scai-audit-page-design-orphans-list) — List pages whose __Final Page Design / __Page Design field points to a missing item

#### scai audit page-design-orphans list

List pages whose __Final Page Design / __Page Design field points to a missing item

```
scai audit page-design-orphans list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)

### scai audit personalization-broken

Find pages with personalization rules referencing missing items

```
scai audit personalization-broken [options] [command]
```

**Subcommands**

- [`scai audit personalization-broken list`](#scai-audit-personalization-broken-list) — List items with broken personalization variant or rule-set references

#### scai audit personalization-broken list

List items with broken personalization variant or rule-set references

```
scai audit personalization-broken list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)

### scai audit references

Find every item with a field that references a target item — generic inbound-reference scan

```
scai audit references [options] [command]
```

**Subcommands**

- [`scai audit references list`](#scai-audit-references-list) — List inbound references to an item

#### scai audit references list

List inbound references to an item

```
scai audit references list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit role-bloat

Find users with more than N role memberships (default 10)

```
scai audit role-bloat [options] [command]
```

**Subcommands**

- [`scai audit role-bloat list`](#scai-audit-role-bloat-list) — List users whose direct role count exceeds --threshold

#### scai audit role-bloat list

List users whose direct role count exceeds --threshold

```
scai audit role-bloat list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--threshold <count>` — Role-count threshold (default 10)
- `--include-admins` — Include administrators (off by default)

### scai audit site-residue

Find SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)

```
scai audit site-residue [options] [command]
```

**Subcommands**

- [`scai audit site-residue list`](#scai-audit-site-residue-list) — List orphan site/tenant subtrees

#### scai audit site-residue list

List orphan site/tenant subtrees

```
scai audit site-residue list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Additional root to scan on top of the SXA defaults. Repeat or comma-separate. (default: `[]`)
- `--content-root <path>` — Override the content root walked when discovering active sites (default /sitecore/content)

### scai audit slug-conflicts

Find siblings sharing the same item name (URL conflict)

```
scai audit slug-conflicts [options] [command]
```

**Subcommands**

- [`scai audit slug-conflicts list`](#scai-audit-slug-conflicts-list) — List parent paths where two or more sibling items share the same name

#### scai audit slug-conflicts list

List parent paths where two or more sibling items share the same name

```
scai audit slug-conflicts list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit stale-content

Find content items not updated in N days — the abandoned-content (graveyard) signal

```
scai audit stale-content [options] [command]
```

**Subcommands**

- [`scai audit stale-content list`](#scai-audit-stale-content-list) — List items not updated in --not-updated-in-days, optionally excluding items currently in a workflow

#### scai audit stale-content list

List items not updated in --not-updated-in-days, optionally excluding items currently in a workflow

```
scai audit stale-content list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit stale-users

Find users inactive for N days (default 180)

```
scai audit stale-users [options] [command]
```

**Subcommands**

- [`scai audit stale-users list`](#scai-audit-stale-users-list) — List users whose UserProfile.lastActivity is older than --not-active-days or null

#### scai audit stale-users list

List users whose UserProfile.lastActivity is older than --not-active-days or null

```
scai audit stale-users list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit stale-workflow

Find items stuck in a workflow state past a stale-after threshold

```
scai audit stale-workflow [options] [command]
```

**Subcommands**

- [`scai audit stale-workflow list`](#scai-audit-stale-workflow-list) — List items in a non-final workflow state with no updates in N days

#### scai audit stale-workflow list

List items in a non-final workflow state with no updates in N days

```
scai audit stale-workflow list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--root <path>` — Content-tree root to scan (default: /sitecore/content)
- `--days <count>` — Stale threshold in days (default: 30)

### scai audit template-dependencies

List every item that references a given template — primary template, base template, insert options, or branch source

```
scai audit template-dependencies [options] [command]
```

**Subcommands**

- [`scai audit template-dependencies list`](#scai-audit-template-dependencies-list) — List inbound references to a template

#### scai audit template-dependencies list

List inbound references to a template

```
scai audit template-dependencies list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--template-id <guid>` — Template item ID to find references for (any GUID form)
- `--skip <kind>` — Skip a reference kind: primary-template, base-template, insert-options, branch-source, datasource-template. Repeat or comma-separate. (default: `[]`)

### scai audit history

Snapshot audit-all results over time + diff across snapshots

```
scai audit history [options] [command]
```

**Subcommands**

- [`scai audit history capture`](#scai-audit-history-capture) — Run `audit all` and persist the result to .scai/audit-history/<env>/
- [`scai audit history list`](#scai-audit-history-list) — List captured snapshots, newest first
- [`scai audit history diff`](#scai-audit-history-diff) — Compare two snapshots and show per-audit deltas (defaults to last two)

#### scai audit history capture

Run `audit all` and persist the result to .scai/audit-history/<env>/

```
scai audit history capture [options]
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

#### scai audit history list

List captured snapshots, newest first

```
scai audit history list [options]
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

#### scai audit history diff

Compare two snapshots and show per-audit deltas (defaults to last two)

```
scai audit history diff [options]
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

### scai audit suite

Run a YAML-defined audit pipeline (codified hygiene policy)

```
scai audit suite [options] [command]
```

**Subcommands**

- [`scai audit suite run`](#scai-audit-suite-run) — Execute a suite file

#### scai audit suite run

Execute a suite file

```
scai audit suite run [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
- `--cache` — Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/
- `--exclude <path>` — Exclude items under this path prefix. Repeat or comma-separate. (default: `[]`)
- `--since <date>` — Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)
- `--owner <user>` — Filter by createdBy or updatedBy (post-fetch filter on Authoring API)
- `--baseline` — Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json
- `--output <file>` — Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)
- `--format <fmt>` — Output format: json (default), csv, markdown
- `--file <path>` — Path to the audit-suite YAML file
- `--only <audits>` — Comma-separated subset of suite audits to run (default: `[]`)

### scai audit translation-coverage

Measure translation coverage between a reference and target language(s)

```
scai audit translation-coverage [options] [command]
```

**Subcommands**

- [`scai audit translation-coverage list`](#scai-audit-translation-coverage-list) — Compare item sets between --reference-language and each --target-language

#### scai audit translation-coverage list

Compare item sets between --reference-language and each --target-language

```
scai audit translation-coverage list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

### scai audit unused-media

Find media library items with zero references from content

```
scai audit unused-media [options] [command]
```

**Subcommands**

- [`scai audit unused-media list`](#scai-audit-unused-media-list) — List media items that aren't referenced by any content

#### scai audit unused-media list

List media items that aren't referenced by any content

```
scai audit unused-media list [options]
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--include-system` — Include /sitecore/system and platform items in the scan
- `--limit <count>` — Maximum number of items to inspect
- `--concurrency <count>` — Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)
- `--batch-size <count>` — Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)
- `--page-parallelism <count>` — Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)
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

## scai cleanup

Mutating hygiene operations — versions, archive, templates, duplicates, find-replace, workflow, folders, roles, users. Honours --what-if and --allow-write.

```
scai cleanup [options] [command]
```

**Subcommands**

- [`scai cleanup archive`](#scai-cleanup-archive) — Operations against the Sitecore archive (recycle bin)
- [`scai cleanup dead-templates`](#scai-cleanup-dead-templates) — Delete templates that have zero items derived from them
- [`scai cleanup duplicates`](#scai-cleanup-duplicates) — Delete duplicate-content items, keeping one per group per --keep-rule
- [`scai cleanup empty-folders`](#scai-cleanup-empty-folders) — Delete folder-like items with no children, recursively bottom-up
- [`scai cleanup field-set`](#scai-cleanup-field-set) — Bulk-edit one field across a content scope — replace, add (multilist), remove (multilist), clear
- [`scai cleanup find-replace`](#scai-cleanup-find-replace) — Apply a find-replace operation across content field values
- [`scai cleanup language-versions`](#scai-cleanup-language-versions) — Bulk-create language versions across items so translators can pick them up
- [`scai cleanup publish`](#scai-cleanup-publish) — Bulk-publish a curated list of items, or every item under a root
- [`scai cleanup rename`](#scai-cleanup-rename) — Bulk-rename items by pattern (modifies item Name and thus the URL slug)
- [`scai cleanup roles`](#scai-cleanup-roles) — Delete empty roles (the cleanup counterpart to `audit empty-roles`)
- [`scai cleanup site-residue`](#scai-cleanup-site-residue) — Delete SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)
- [`scai cleanup slug-conflicts`](#scai-cleanup-slug-conflicts) — Resolve sibling-name conflicts surfaced by `audit slug-conflicts` (delete or rename losers per --keep-rule)
- [`scai cleanup subtree`](#scai-cleanup-subtree) — Delete a Sitecore subtree bottom-up, with hard-block on external inbound references
- [`scai cleanup users`](#scai-cleanup-users) — Delete stale users (the cleanup counterpart to `audit stale-users`)
- [`scai cleanup versions`](#scai-cleanup-versions) — Prune or archive per-item version history down to the N most recent versions
- [`scai cleanup workflow`](#scai-cleanup-workflow) — Mutating workflow operations (advance stale items, bulk-attach a workflow, etc.)

### scai cleanup archive

Operations against the Sitecore archive (recycle bin)

```
scai cleanup archive [options] [command]
```

**Subcommands**

- [`scai cleanup archive purge`](#scai-cleanup-archive-purge) — Permanently delete archived items older than --older-than-days N

#### scai cleanup archive purge

Permanently delete archived items older than --older-than-days N

```
scai cleanup archive purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup dead-templates

Delete templates that have zero items derived from them

```
scai cleanup dead-templates [options] [command]
```

**Subcommands**

- [`scai cleanup dead-templates purge`](#scai-cleanup-dead-templates-purge) — Delete dead templates, optionally cleaning up empty template folders left behind

#### scai cleanup dead-templates purge

Delete dead templates, optionally cleaning up empty template folders left behind

```
scai cleanup dead-templates purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)

### scai cleanup duplicates

Delete duplicate-content items, keeping one per group per --keep-rule

```
scai cleanup duplicates [options] [command]
```

**Subcommands**

- [`scai cleanup duplicates purge`](#scai-cleanup-duplicates-purge) — Delete duplicates per keep-rule (default: oldest creation date wins)

#### scai cleanup duplicates purge

Delete duplicates per keep-rule (default: oldest creation date wins)

```
scai cleanup duplicates purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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
- `--include-system-fields` — Include __-prefixed system fields when computing the content hash
- `--keep-rule <rule>` — Which member of each duplicate group survives (default: `"oldest"`)
- `--concurrency <count>` — Delete concurrency (default: 4)
- `--batch-size <count>` — Aliased GraphQL batch size for field reads

### scai cleanup empty-folders

Delete folder-like items with no children, recursively bottom-up

```
scai cleanup empty-folders [options] [command]
```

**Subcommands**

- [`scai cleanup empty-folders purge`](#scai-cleanup-empty-folders-purge) — Walk --root depth-first and delete every item whose subtree is empty

#### scai cleanup empty-folders purge

Walk --root depth-first and delete every item whose subtree is empty

```
scai cleanup empty-folders purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup field-set

Bulk-edit one field across a content scope — replace, add (multilist), remove (multilist), clear

```
scai cleanup field-set [options] [command]
```

**Subcommands**

- [`scai cleanup field-set apply`](#scai-cleanup-field-set-apply) — Write a value to the named --field across matching items

#### scai cleanup field-set apply

Write a value to the named --field across matching items

```
scai cleanup field-set apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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
- `--include-system-fields` — Allow writing to __-prefixed system fields (off by default)
- `--cache` — Use the on-disk field cache for the discovery phase

### scai cleanup find-replace

Apply a find-replace operation across content field values

```
scai cleanup find-replace [options] [command]
```

**Subcommands**

- [`scai cleanup find-replace apply`](#scai-cleanup-find-replace-apply) — Replace --pattern with --replacement in matching field values

#### scai cleanup find-replace apply

Replace --pattern with --replacement in matching field values

```
scai cleanup find-replace apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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
- `--include-system-fields` — Include __-prefixed system fields in the search (off by default; touching __Renderings via regex will mangle XML)
- `--root <path>` — Content-tree root (default: /sitecore/content)
- `--language <code>` — Restrict to one language
- `--limit <count>` — Cap on items inspected (default: 5000)
- `--max-mutations <count>` — Maximum number of items to mutate per run (default: 100). Defends against runaway regex matches
- `--index <name>` — Override the search index name
- `--include-system` — Include /sitecore/system items in the scan (off by default)
- `--cache` — Use the on-disk field cache for the discovery phase

### scai cleanup language-versions

Bulk-create language versions across items so translators can pick them up

```
scai cleanup language-versions [options] [command]
```

**Subcommands**

- [`scai cleanup language-versions add`](#scai-cleanup-language-versions-add) — Add empty (or copied) language versions to items in --root

#### scai cleanup language-versions add

Add empty (or copied) language versions to items in --root

```
scai cleanup language-versions add [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup publish

Bulk-publish a curated list of items, or every item under a root

```
scai cleanup publish [options] [command]
```

**Subcommands**

- [`scai cleanup publish dispatch`](#scai-cleanup-publish-dispatch) — Dispatch a single publish job covering the supplied scope

#### scai cleanup publish dispatch

Dispatch a single publish job covering the supplied scope

```
scai cleanup publish dispatch [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--items <ids>` — Comma-separated item IDs or content-tree paths to publish (mutually exclusive with --root) (default: `[]`)
- `--root <path>` — Content-tree root — publish every descendant (mutually exclusive with --items)
- `--languages <codes>` — Comma-separated language codes (default: tenant primary) (default: `[]`)
- `--target <name>` — Publish target (e.g. web). Default: all configured
- `--republish` — Re-publish unchanged items (default: incremental)
- `--max-publishes <count>` — Maximum number of items to publish per run (default: 1000)
- `--poll-timeout-ms <ms>` — Poll publishingStatus until completion or this timeout (default: 0 = fire-and-return)
- `--poll-interval-ms <ms>` — Polling cadence in ms when --poll-timeout-ms > 0 (default: 2000)

### scai cleanup rename

Bulk-rename items by pattern (modifies item Name and thus the URL slug)

```
scai cleanup rename [options] [command]
```

**Subcommands**

- [`scai cleanup rename apply`](#scai-cleanup-rename-apply) — Rename items whose name matches --pattern to the --replacement form

#### scai cleanup rename apply

Rename items whose name matches --pattern to the --replacement form

```
scai cleanup rename apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup roles

Delete empty roles (the cleanup counterpart to `audit empty-roles`)

```
scai cleanup roles [options] [command]
```

**Subcommands**

- [`scai cleanup roles purge-empty`](#scai-cleanup-roles-purge-empty) — Delete every role flagged by `audit empty-roles list`

#### scai cleanup roles purge-empty

Delete every role flagged by `audit empty-roles list`

```
scai cleanup roles purge-empty [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup site-residue

Delete SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)

```
scai cleanup site-residue [options] [command]
```

**Subcommands**

- [`scai cleanup site-residue purge`](#scai-cleanup-site-residue-purge) — Delete orphan tenant/site subtrees identified by `audit site-residue`. Defaults to plan-mode; combine --what-if with --allow-write to mutate.

#### scai cleanup site-residue purge

Delete orphan tenant/site subtrees identified by `audit site-residue`. Defaults to plan-mode; combine --what-if with --allow-write to mutate.

```
scai cleanup site-residue purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--concurrency <count>` — Concurrent deletes / pre-flight scans (default: 4)

### scai cleanup slug-conflicts

Resolve sibling-name conflicts surfaced by `audit slug-conflicts` (delete or rename losers per --keep-rule)

```
scai cleanup slug-conflicts [options] [command]
```

**Subcommands**

- [`scai cleanup slug-conflicts purge`](#scai-cleanup-slug-conflicts-purge) — Delete or rename losing siblings per --keep-rule (default: oldest wins, action delete)

#### scai cleanup slug-conflicts purge

Delete or rename losing siblings per --keep-rule (default: oldest wins, action delete)

```
scai cleanup slug-conflicts purge [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup subtree

Delete a Sitecore subtree bottom-up, with hard-block on external inbound references

```
scai cleanup subtree [options] [command]
```

**Subcommands**

- [`scai cleanup subtree delete`](#scai-cleanup-subtree-delete) — Walk a subtree leaf-first and delete every descendant + the root

#### scai cleanup subtree delete

Walk a subtree leaf-first and delete every descendant + the root

```
scai cleanup subtree delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--fields <name>` — Restrict inbound-ref scan to these field names. Repeat or comma-separate. (default: `[]`)

### scai cleanup users

Delete stale users (the cleanup counterpart to `audit stale-users`)

```
scai cleanup users [options] [command]
```

**Subcommands**

- [`scai cleanup users purge-stale`](#scai-cleanup-users-purge-stale) — Delete users inactive for more than --not-active-days (default 365)

#### scai cleanup users purge-stale

Delete users inactive for more than --not-active-days (default 365)

```
scai cleanup users purge-stale [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup versions

Prune or archive per-item version history down to the N most recent versions

```
scai cleanup versions [options] [command]
```

**Subcommands**

- [`scai cleanup versions prune`](#scai-cleanup-versions-prune) — Permanently delete versions older than the N most recent per (item, language)
- [`scai cleanup versions archive`](#scai-cleanup-versions-archive) — Move versions older than the N most recent per (item, language) to the Sitecore archive (reversible)

#### scai cleanup versions prune

Permanently delete versions older than the N most recent per (item, language)

```
scai cleanup versions prune [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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
- `--index <name>` — Override the search index name (default: sitecore_master_index)
- `--concurrency <count>` — Concurrency for version reads and deletes
- `--include-system` — Include /sitecore/system and platform items in the prune

#### scai cleanup versions archive

Move versions older than the N most recent per (item, language) to the Sitecore archive (reversible)

```
scai cleanup versions archive [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai cleanup workflow

Mutating workflow operations (advance stale items, bulk-attach a workflow, etc.)

```
scai cleanup workflow [options] [command]
```

**Subcommands**

- [`scai cleanup workflow advance`](#scai-cleanup-workflow-advance) — Execute a workflow command on items stuck past --stale-days
- [`scai cleanup workflow apply`](#scai-cleanup-workflow-apply) — Bulk-attach a workflow to items under --root (sets __Workflow + __Workflow state directly). Use to backfill content authored before the workflow existed.

#### scai cleanup workflow advance

Execute a workflow command on items stuck past --stale-days

```
scai cleanup workflow advance [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai cleanup workflow apply

Bulk-attach a workflow to items under --root (sets __Workflow + __Workflow state directly). Use to backfill content authored before the workflow existed.

```
scai cleanup workflow apply [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `--allow-write` — Allow write operations for this command without updating config
- `--force` — Perform force sync. In case you have invalid includes
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--workflow <ref>` — Workflow GUID, content-tree path, or display/item name (case-insensitive)
- `--state <ref>` — Target state (GUID or name). Defaults to the workflow's __Initial state.
- `--template <ref>` — Only attach to items conforming to this template (GUID or absolute /sitecore/templates path).
- `--reattach` — Overwrite items already attached to a different workflow. Off by default — already-attached items are skipped so the verb defaults to a safe backfill.
- `--stale-days <count>` — Only act on items not updated for at least N days. Optional — omit to attach to every match.
- `--root <path>` — Content root (default: /sitecore/content)
- `--max-applies <count>` — Cap on items attached per run (default 100)
- `--limit <count>` — Cap on items inspected (default 5000)
- `--index <name>` — Override the search index
- `--include-system` — Include /sitecore/system items

## scai config

Configuration utilities

```
scai config [options] [command]
```

**Subcommands**

- [`scai config validate`](#scai-config-validate) — Validate sitecoreai.cli.json

### scai config validate

Validate sitecoreai.cli.json

```
scai config validate [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai deploy

XM Cloud Deploy API commands

```
scai deploy [options] [command]
```

**Subcommands**

- [`scai deploy deployments`](#scai-deploy-deployments) — Deployment operations
- [`scai deploy editing-host`](#scai-deploy-editing-host) — Editing host operations
- [`scai deploy environments`](#scai-deploy-environments) — Environment operations
- [`scai deploy logs`](#scai-deploy-logs) — Environment log files
- [`scai deploy organizations`](#scai-deploy-organizations) — Organization operations
- [`scai deploy projects`](#scai-deploy-projects) — Project operations
- [`scai deploy site`](#scai-deploy-site) — SXA site operations
- [`scai deploy source-control`](#scai-deploy-source-control) — Source control operations

### scai deploy deployments

Deployment operations

**Aliases:** `dep`

```
scai deploy deployments [options] [command]
```

**Subcommands**

- [`scai deploy deployments cancel`](#scai-deploy-deployments-cancel) — Cancel a deployment
- [`scai deploy deployments deploy`](#scai-deploy-deployments-deploy) — Start a deployment
- [`scai deploy deployments get`](#scai-deploy-deployments-get) — Get a deployment by ID
- [`scai deploy deployments list`](#scai-deploy-deployments-list) — List deployments
- [`scai deploy deployments logs`](#scai-deploy-deployments-logs) — Get deployment logs
- [`scai deploy deployments source`](#scai-deploy-deployments-source) — Upload deployment source
- [`scai deploy deployments status`](#scai-deploy-deployments-status) — Get deployment counts grouped by status
- [`scai deploy deployments watch`](#scai-deploy-deployments-watch) — Watch deployment status

#### scai deploy deployments cancel

Cancel a deployment

```
scai deploy deployments cancel [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID

#### scai deploy deployments deploy

Start a deployment

```
scai deploy deployments deploy [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID

#### scai deploy deployments get

Get a deployment by ID

```
scai deploy deployments get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID

#### scai deploy deployments list

List deployments

```
scai deploy deployments list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--status <status>` — Filter by deployment status

#### scai deploy deployments logs

Get deployment logs

```
scai deploy deployments logs [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID
- `--output <path>` — Output file path

#### scai deploy deployments source

Upload deployment source

```
scai deploy deployments source [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID
- `--file <path>` — Path to source archive
- `--directory <path>` — Directory to zip and upload

#### scai deploy deployments status

Get deployment counts grouped by status

```
scai deploy deployments status [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy deployments watch

Watch deployment status

```
scai deploy deployments watch [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Deployment ID
- `--wait-for-post-actions` — Wait for post-actions to complete
- `--timeout <seconds>` — Timeout in seconds before exiting watch

### scai deploy editing-host

Editing host operations

**Aliases:** `eh`

```
scai deploy editing-host [options] [command]
```

**Subcommands**

- [`scai deploy editing-host create`](#scai-deploy-editing-host-create) — Create an editing host environment
- [`scai deploy editing-host delete`](#scai-deploy-editing-host-delete) — Delete an editing host environment
- [`scai deploy editing-host deploy`](#scai-deploy-editing-host-deploy) — Deploy an editing host environment
- [`scai deploy editing-host list`](#scai-deploy-editing-host-list) — List editing host environments
- [`scai deploy editing-host update`](#scai-deploy-editing-host-update) — Update an editing host environment

#### scai deploy editing-host create

Create an editing host environment

```
scai deploy editing-host create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--cm-environment-id <id>` — CM environment ID
- `--name <name>` — Editing host name

#### scai deploy editing-host delete

Delete an editing host environment

```
scai deploy editing-host delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Editing host environment ID
- `--force` — Force delete environment

#### scai deploy editing-host deploy

Deploy an editing host environment

```
scai deploy editing-host deploy [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy editing-host list

List editing host environments

```
scai deploy editing-host list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy editing-host update

Update an editing host environment

```
scai deploy editing-host update [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Editing host environment ID
- `--name <name>` — Editing host name

### scai deploy environments

Environment operations

**Aliases:** `env`

```
scai deploy environments [options] [command]
```

**Subcommands**

- [`scai deploy environments create`](#scai-deploy-environments-create) — Create an environment
- [`scai deploy environments delete`](#scai-deploy-environments-delete) — Delete an environment by name or ID
- [`scai deploy environments deployments`](#scai-deploy-environments-deployments) — Environment deployments
- [`scai deploy environments get`](#scai-deploy-environments-get) — Get an environment by name or ID
- [`scai deploy environments get-edge-token`](#scai-deploy-environments-get-edge-token) — Get edge token for an environment
- [`scai deploy environments get-editing-secret`](#scai-deploy-environments-get-editing-secret) — Get editing secret for an environment
- [`scai deploy environments health`](#scai-deploy-environments-health) — Probe environment health (GET <cmHost>/healthz/ready)
- [`scai deploy environments limitation`](#scai-deploy-environments-limitation) — Get environment limitations
- [`scai deploy environments link-repository`](#scai-deploy-environments-link-repository) — Link a repository to an environment
- [`scai deploy environments list`](#scai-deploy-environments-list) — List environments
- [`scai deploy environments promote`](#scai-deploy-environments-promote) — Promote a deployment to this environment
- [`scai deploy environments regenerate-context`](#scai-deploy-environments-regenerate-context) — Regenerate environment context
- [`scai deploy environments restart`](#scai-deploy-environments-restart) — Restart an environment
- [`scai deploy environments unlink-repository`](#scai-deploy-environments-unlink-repository) — Unlink a repository from an environment
- [`scai deploy environments variables`](#scai-deploy-environments-variables) — Environment variables

#### scai deploy environments create

Create an environment

```
scai deploy environments create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy environments delete

Delete an environment by name or ID

```
scai deploy environments delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy environments deployments

Environment deployments

```
scai deploy environments deployments [options] [command]
```

**Subcommands**

- [`scai deploy environments deployments create`](#scai-deploy-environments-deployments-create) — Deploy to an environment
- [`scai deploy environments deployments list`](#scai-deploy-environments-deployments-list) — List deployments for an environment

##### scai deploy environments deployments create

Deploy to an environment

```
scai deploy environments deployments create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

##### scai deploy environments deployments list

List deployments for an environment

```
scai deploy environments deployments list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai deploy environments get

Get an environment by name or ID

```
scai deploy environments get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai deploy environments get-edge-token

Get edge token for an environment

```
scai deploy environments get-edge-token [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai deploy environments get-editing-secret

Get editing secret for an environment

```
scai deploy environments get-editing-secret [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai deploy environments health

Probe environment health (GET <cmHost>/healthz/ready)

```
scai deploy environments health [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai deploy environments limitation

Get environment limitations

```
scai deploy environments limitation [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy environments link-repository

Link a repository to an environment

```
scai deploy environments link-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy environments list

List environments

```
scai deploy environments list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--project <value>` — Project name or ID
- `--type <cm|eh>` — Filter by project type (cm or eh)
- `--all` — Fetch every page and return the consolidated result set (default: one page)
- `--page <n>` — 1-based page number (ignored with --all)
- `--page-size <n>` — Page size. Defaults to 50 with --all, otherwise the API default (10).

#### scai deploy environments promote

Promote a deployment to this environment

```
scai deploy environments promote [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy environments regenerate-context

Regenerate environment context

```
scai deploy environments regenerate-context [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai deploy environments restart

Restart an environment

```
scai deploy environments restart [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy environments unlink-repository

Unlink a repository from an environment

```
scai deploy environments unlink-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

#### scai deploy environments variables

Environment variables

```
scai deploy environments variables [options] [command]
```

**Subcommands**

- [`scai deploy environments variables create`](#scai-deploy-environments-variables-create) — Create or update an environment variable
- [`scai deploy environments variables delete`](#scai-deploy-environments-variables-delete) — Delete an environment variable
- [`scai deploy environments variables list`](#scai-deploy-environments-variables-list) — List environment variables

##### scai deploy environments variables create

Create or update an environment variable

```
scai deploy environments variables create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

##### scai deploy environments variables delete

Delete an environment variable

```
scai deploy environments variables delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

##### scai deploy environments variables list

List environment variables

```
scai deploy environments variables list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Environment ID
- `--name <name>` — Environment name
- `--project <value>` — Project name or ID

### scai deploy logs

Environment log files

**Aliases:** `log`

```
scai deploy logs [options] [command]
```

**Subcommands**

- [`scai deploy logs data`](#scai-deploy-logs-data) — Download a log file
- [`scai deploy logs list`](#scai-deploy-logs-list) — List environment log files
- [`scai deploy logs view`](#scai-deploy-logs-view) — View a log file

#### scai deploy logs data

Download a log file

```
scai deploy logs data [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy logs list

List environment log files

```
scai deploy logs list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy logs view

View a log file

```
scai deploy logs view [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

### scai deploy organizations

Organization operations

**Aliases:** `org`

```
scai deploy organizations [options] [command]
```

**Subcommands**

- [`scai deploy organizations get`](#scai-deploy-organizations-get) — Get the current organization
- [`scai deploy organizations health`](#scai-deploy-organizations-health) — Get organization health
- [`scai deploy organizations launch-demo`](#scai-deploy-organizations-launch-demo) — Launch demo solution
- [`scai deploy organizations license`](#scai-deploy-organizations-license) — Get organization license

#### scai deploy organizations get

Get the current organization

```
scai deploy organizations get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy organizations health

Get organization health

```
scai deploy organizations health [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy organizations launch-demo

Launch demo solution

```
scai deploy organizations launch-demo [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy organizations license

Get organization license

```
scai deploy organizations license [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

### scai deploy projects

Project operations

**Aliases:** `proj`

```
scai deploy projects [options] [command]
```

**Subcommands**

- [`scai deploy projects create`](#scai-deploy-projects-create) — Create a project
- [`scai deploy projects delete`](#scai-deploy-projects-delete) — Delete a project by name or ID
- [`scai deploy projects get`](#scai-deploy-projects-get) — Get a project by name or ID
- [`scai deploy projects limitation`](#scai-deploy-projects-limitation) — Get project limitations
- [`scai deploy projects link-repository`](#scai-deploy-projects-link-repository) — Link a repository to a project
- [`scai deploy projects list`](#scai-deploy-projects-list) — List projects
- [`scai deploy projects unlink-repository`](#scai-deploy-projects-unlink-repository) — Unlink a repository from a project
- [`scai deploy projects update`](#scai-deploy-projects-update) — Update a project by name or ID
- [`scai deploy projects validate-name`](#scai-deploy-projects-validate-name) — Validate that a project name is unique

#### scai deploy projects create

Create a project

```
scai deploy projects create [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy projects delete

Delete a project by name or ID

```
scai deploy projects delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID
- `--name <name>` — Project name
- `--force` — Skip confirmation prompt

#### scai deploy projects get

Get a project by name or ID

```
scai deploy projects get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID
- `--name <name>` — Project name

#### scai deploy projects limitation

Get project limitations

```
scai deploy projects limitation [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy projects link-repository

Link a repository to a project

```
scai deploy projects link-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy projects list

List projects

```
scai deploy projects list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--all` — Fetch every page and return the consolidated result set (default: one page)
- `--page <n>` — 1-based page number (ignored with --all)
- `--page-size <n>` — Page size. Defaults to 50 with --all, otherwise the API default (10).

#### scai deploy projects unlink-repository

Unlink a repository from a project

```
scai deploy projects unlink-repository [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Project ID

#### scai deploy projects update

Update a project by name or ID

```
scai deploy projects update [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy projects validate-name

Validate that a project name is unique

```
scai deploy projects validate-name [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--name <name>` — Project name

### scai deploy site

SXA site operations

**Aliases:** `sites`

```
scai deploy site [options] [command]
```

**Subcommands**

- [`scai deploy site bind`](#scai-deploy-site-bind) — Populate Site Grouping fields (HostName / StartItem / RenderingHost) so the site appears in Pages / Channels
- [`scai deploy site list`](#scai-deploy-site-list) — List SXA sites in a CM environment

#### scai deploy site bind

Populate Site Grouping fields (HostName / StartItem / RenderingHost) so the site appears in Pages / Channels

```
scai deploy site bind [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

#### scai deploy site list

List SXA sites in a CM environment

**Aliases:** `ls`

```
scai deploy site list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--hostnames` — Resolve declared hostnames per site (adds an N+1 round trip per site)
- `--content-root <path>` — Override the content root walked. Default `/sitecore/content`.

### scai deploy source-control

Source control operations

**Aliases:** `sc`

```
scai deploy source-control [options] [command]
```

**Subcommands**

- [`scai deploy source-control access-token`](#scai-deploy-source-control-access-token) — Get source control integration access token
- [`scai deploy source-control delete`](#scai-deploy-source-control-delete) — Delete a source control integration
- [`scai deploy source-control get`](#scai-deploy-source-control-get) — Get a source control integration
- [`scai deploy source-control list`](#scai-deploy-source-control-list) — List source control integrations
- [`scai deploy source-control providers`](#scai-deploy-source-control-providers) — List source control providers
- [`scai deploy source-control repository`](#scai-deploy-source-control-repository) — Source control repository operations
- [`scai deploy source-control state`](#scai-deploy-source-control-state) — Get OAuth state for integration
- [`scai deploy source-control templates`](#scai-deploy-source-control-templates) — List source control templates
- [`scai deploy source-control validate`](#scai-deploy-source-control-validate) — Validate source control integration

#### scai deploy source-control access-token

Get source control integration access token

```
scai deploy source-control access-token [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

#### scai deploy source-control delete

Delete a source control integration

```
scai deploy source-control delete [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

#### scai deploy source-control get

Get a source control integration

```
scai deploy source-control get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

#### scai deploy source-control list

List source control integrations

```
scai deploy source-control list [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy source-control providers

List source control providers

```
scai deploy source-control providers [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy source-control repository

Source control repository operations

```
scai deploy source-control repository [options] [command]
```

**Subcommands**

- [`scai deploy source-control repository branches`](#scai-deploy-source-control-repository-branches) — List repository branches
- [`scai deploy source-control repository create-from-template`](#scai-deploy-source-control-repository-create-from-template) — Create repository from template
- [`scai deploy source-control repository get`](#scai-deploy-source-control-repository-get) — Get source control repository
- [`scai deploy source-control repository validate`](#scai-deploy-source-control-repository-validate) — Validate source control repository

##### scai deploy source-control repository branches

List repository branches

```
scai deploy source-control repository branches [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--repository-name <name>` — Repository name
- `--integration-id <id>` — Integration ID

##### scai deploy source-control repository create-from-template

Create repository from template

```
scai deploy source-control repository create-from-template [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
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

##### scai deploy source-control repository get

Get source control repository

```
scai deploy source-control repository get [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--integration-id <id>` — Integration ID
- `--repository-id <id>` — Repository ID

##### scai deploy source-control repository validate

Validate source control repository

```
scai deploy source-control repository validate [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--integration-id <id>` — Integration ID
- `--repository-name <name>` — Repository name

#### scai deploy source-control state

Get OAuth state for integration

```
scai deploy source-control state [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

#### scai deploy source-control templates

List source control templates

```
scai deploy source-control templates [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--provider <name>` — Provider (ado or github)

#### scai deploy source-control validate

Validate source control integration

```
scai deploy source-control validate [options]
```

**Options**

- `-n, --environment-name <name>` — Config environment name from sitecoreai.cli.json (alias: --env-name)
- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-w, --what-if` — Lists commands that would be executed, without executing them
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
- `--id <id>` — Integration ID

## scai history

Show CLI activity history

```
scai history [options]
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

## scai init

Create or update an environment with project selection and SitecoreAI credentials

```
scai init [options]
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
- `--organization-id <id>` — Sitecore organization ID
- `--tenant-id <id>` — Sitecore tenant ID
- `--organization <name>` — Organization name or ID (Deploy API)
- `--project <value>` — Project name or ID (Deploy API)
- `--environment <value>` — Environment name or ID (Deploy API)
- `--deploy-token <token>` — SitecoreAI access token (Deploy + CM/admin scopes)
- `--client-id <id>` — SitecoreAI client ID
- `--client-secret <secret>` — SitecoreAI client secret
- `--use-client-credentials` — Use client credentials instead of interactive login
- `--set-default` — Set as default environment

## scai login

Authenticate with SitecoreAI and store an access token (Deploy + CM/admin scopes)

```
scai login [options] [command]
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
- `--client-id <id>` — SitecoreAI client ID
- `--client-secret <secret>` — SitecoreAI client secret
- `--use-client-credentials` — Use client credentials instead of interactive login
- `--print` — Print the access token to stdout

**Subcommands**

- [`scai login ai-skills`](#scai-login-ai-skills) — Provision a Sitecore AI Skills credential (Brand Management + Brand Review) for the active environment's organization

### scai login ai-skills

Provision a Sitecore AI Skills credential (Brand Management + Brand Review) for the active environment's organization

**Aliases:** `ai-skill`, `aiskills`, `aiskill`

```
scai login ai-skills [options]
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
- `--org-id <id>` — Sitecore organizationId to bind the credential to. Defaults to the env profile's organizationId.
- `--client-id <id>` — AI APIs key Client ID
- `--client-secret <secret>` — AI APIs key Client Secret
- `--authority <url>` — OAuth authority. Defaults to https://auth.sitecorecloud.io.
- `--audience <url>` — OAuth audience. Defaults to https://api.sitecorecloud.io.
- `--force` — Overwrite an existing credential for this org without prompting

## scai logout

Clear stored authentication tokens

```
scai logout [options]
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

## scai serialization

Item serialization commands

**Aliases:** `ser`

```
scai serialization [options] [command]
```

**Subcommands**

- [`scai serialization diff`](#scai-serialization-diff) — Compares two Sitecore instances
- [`scai serialization explain`](#scai-serialization-explain) — Explains whether an item path is included and why
- [`scai serialization info`](#scai-serialization-info) — Shows serialization configuration information
- [`scai serialization package`](#scai-serialization-package) — Create or install packages of serialized items
- [`scai serialization pull`](#scai-serialization-pull) — Pulls serialized items from Sitecore to disk
- [`scai serialization push`](#scai-serialization-push) — Pushes serialized items from disk into Sitecore
- [`scai serialization validate`](#scai-serialization-validate) — Checks serialized items for validity and can fix common issues
- [`scai serialization watch`](#scai-serialization-watch) — Watches item changes in Sitecore and pulls them to disk

### scai serialization diff

Compares two Sitecore instances

```
scai serialization diff [options]
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

### scai serialization explain

Explains whether an item path is included and why

```
scai serialization explain [options]
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

### scai serialization info

Shows serialization configuration information

```
scai serialization info [options]
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

### scai serialization package

Create or install packages of serialized items

**Aliases:** `pkg`

```
scai serialization package [options] [command]
```

**Subcommands**

- [`scai serialization package create`](#scai-serialization-package-create) — Creates a new serialized item package
- [`scai serialization package install`](#scai-serialization-package-install) — Install an existing item package to Sitecore

#### scai serialization package create

Creates a new serialized item package

```
scai serialization package create [options]
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

#### scai serialization package install

Install an existing item package to Sitecore

```
scai serialization package install [options]
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

### scai serialization pull

Pulls serialized items from Sitecore to disk

```
scai serialization pull [options]
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

### scai serialization push

Pushes serialized items from disk into Sitecore

```
scai serialization push [options]
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

### scai serialization validate

Checks serialized items for validity and can fix common issues

```
scai serialization validate [options]
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

### scai serialization watch

Watches item changes in Sitecore and pulls them to disk

```
scai serialization watch [options]
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

## scai status

Show configured Sitecore environments for this CLI

```
scai status [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input

## scai telemetry

Telemetry utilities

```
scai telemetry [options] [command]
```

**Subcommands**

- [`scai telemetry status`](#scai-telemetry-status) — Show telemetry status

### scai telemetry status

Show telemetry status

```
scai telemetry status [options]
```

**Options**

- `-c, --config <path>` — Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself).
- `-v, --verbose` — Write some additional diagnostic and performance data
- `-t, --trace` — Write more additional diagnostic and performance data
- `-q, --quiet` — Suppress non-error output
- `--json` — Output machine-readable JSON
- `--log-file <path>` — Write logs to a file
- `--non-interactive` — Disable prompts and require explicit input
