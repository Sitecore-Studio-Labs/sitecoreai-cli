# Serialization

`scai provision serialization` (alias: `ser`) provides YAML pull/push/diff/validate/watch
against the Sitecore Content Serialization (SCS) format, talking to the
Sitecore Management + Authoring GraphQL APIs over `/sitecore/api/management`
on the configured CM host.

This is conceptually the same surface as the dotnet `Sitecore.DevEx`
serialization commands, but runs natively (no .NET dependency).

## What gets serialized

| Surface      | Source                                    |
| ------------ | ----------------------------------------- |
| Items        | GraphQL item / metadata / history queries |
| Roles, users | GraphQL role + user queries               |
| Filesystem   | YAML files in module serialization paths  |

Output uses deterministic YAML so diffs are stable across machines.

## Authentication

OAuth2 against the configured `authority`. The CLI supports:

- Client credentials (set `useClientCredentials: true`, supply
  `clientId` + `clientSecret` via env var)
- Interactive browser login (TTY only)
- Cached access tokens in the OS keychain when
  `settings.cacheAuthenticationToken` is `true` (default)

See [`configuration.md`](./configuration.md#authentication).

## Common commands

```sh
scai provision serialization info        # show the resolved serialization config
scai provision serialization explain     # explain what a pull/push would do
scai provision serialization pull        # fetch items into the local SCS store
scai provision serialization push        # push local SCS state back to CM
scai provision serialization diff        # compare local SCS state vs the remote CM
scai provision serialization validate    # validate module config + filesystem state
scai provision serialization watch       # poll for remote changes and pull deltas
scai provision serialization package create   # create a package (alias: pkg)
scai provision serialization package install  # install a package (alias: pkg)
```

### `diff` modes

`scai provision serialization diff` runs in one of two modes depending on flags:

| Mode                   | Trigger                                                                   | What it compares                                                |
| ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `local-vs-instance`    | No `--source` / `--destination` (or both set to the same env name)        | Local SCS store vs the configured environment                   |
| `instance-vs-instance` | `--source <A> --destination <B>` (or `--source-env <A> --target-env <B>`) | Two live Sitecore environments, fetched in parallel via GraphQL |

Flag aliases (matching dotnet `Sitecore.DevEx`):

- `-s, --source <name>` ↔ `--source-env <name>`
- `-d, --destination <name>` ↔ `--target-env <name>`

```sh
# Two-environment diff (read-only)
scai provision ser diff --source-env staging --target-env prod

# Apply the diff: bring prod in line with staging
scai provision ser diff --source-env staging --target-env prod --push

# Dry-run the push (build the plan, don't write)
scai provision ser diff --source-env staging --target-env prod --push --what-if

# Allow writes for this invocation without editing sitecoreai.cli.json
scai provision ser diff --source-env staging --target-env prod --push --allow-write
```

Notes:

- **Module config comes from the local project.** The `*.module.json`
  includes/excludes that scope the comparison are read from the project
  the CLI is invoked from — not from either environment. Use `-p <path>`
  to diff a specific subtree without modules.
- **Empty-source guard.** `--push` with a source that has zero items
  against a populated destination would recycle every item in the
  destination. The diff refuses to proceed without `--force`.
- **Concurrency-bounded.** Source + destination metadata fetches run
  concurrently; per-item body fetches are bounded by
  `SITECOREAI_HTTP_CONCURRENCY` (default 8). See [Performance](#performance).
- **`--json` output** includes `mode`, `source`, `destination`, and a
  per-database `differences` count. Add `--verbose` to include a
  `changes` block per database with the create / update / recycle /
  move / rename targets.

For the full surface — flags, defaults, exit codes — see
[`commands.md`](./commands.md).

## Performance

The two-environment diff path is shaped for concurrency:

- Source and destination metadata fetches run in parallel (`Promise.all`).
- Within each environment, per-subtree metadata fetches run with bounded
  concurrency (default 8, override via `SITECOREAI_HTTP_CONCURRENCY`).
- On `--push`, source and destination item-body collection
  (`collectItemData`) run in parallel.
- The per-item `fetchItemData` fanout inside `collectItemData` is also
  bounded-concurrent — the biggest wall-clock win for trees with many
  items, and the same speedup applies to `ser pull` and `ser push`.

Concurrency is deliberately bounded to avoid hitting rate limits or
exhausting sockets. For very large tenants, narrow the diff with
`-p <path>` before increasing concurrency.

## Safety

- Writes (`push`, `package install`) require `allowWrite: true` in the
  environment config.
- Use `--what-if` on any command to preview what would change without
  contacting the API.
- `--force` overrides write protection only when the environment is
  explicitly marked write-safe.

## Module config

Modules live in `*.module.json` files in your serialization roots. They
describe what items to include/exclude, alias rules, and conflict
resolution behavior. The CLI validates module files against the module
JSON schema (shipped in `dist/config/`) before any operation runs.

## Watch loop

`scai provision serialization watch` polls the GraphQL history endpoint for remote
changes and pulls deltas as they arrive. In CI, use `--timeout <seconds>`
to bound the loop:

```sh
scai provision serialization watch --timeout 1800
```

## Aliases

- `serialization` → `ser`
- `serialization package` → `pkg`
