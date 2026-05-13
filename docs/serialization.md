# Serialization

`scai serialization` (alias: `ser`) provides YAML pull/push/diff/validate/watch
against the Sitecore Content Serialization (SCS) format, talking to the
Sitecore Management + Authoring GraphQL APIs over `/sitecore/api/management`
on the configured CM host.

This is conceptually the same surface as the dotnet `Sitecore.DevEx`
serialization commands, but runs natively (no .NET dependency).

## What gets serialized

| Surface      | Source                                           |
| ------------ | ------------------------------------------------ |
| Items        | GraphQL item / metadata / history queries        |
| Roles, users | GraphQL role + user queries                      |
| Filesystem   | YAML files in module serialization paths         |

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
scai serialization info        # show the resolved serialization config
scai serialization explain     # explain what a pull/push would do
scai serialization pull        # fetch items into the local SCS store
scai serialization push        # push local SCS state back to CM
scai serialization diff        # compare local SCS state vs the remote CM
scai serialization validate    # validate module config + filesystem state
scai serialization watch       # poll for remote changes and pull deltas
scai serialization package create   # create a package (alias: pkg)
scai serialization package install  # install a package (alias: pkg)
```

### `diff` semantics — different from `Sitecore.DevEx`

`scai serialization diff` compares **the local SCS store against a single
remote CM** (the configured environment). It does **not** support the
dotnet `sitecore ser diff --source <A> --destination <B>` mode that
compares two live Sitecore instances against each other.

If you need instance-to-instance comparison, the workflow is:

```sh
scai ser pull -n source-env       # serialize source instance to disk
scai ser diff -n destination-env  # diff that disk state against destination
```

Two-instance diff is on the roadmap (see [roadmap](./roadmap.md)) with a
`--source-env` / `--target-env` flag pair and a `--push` variant that
mirrors dotnet's `ser diff --source A --destination B --push`.

For the full surface — flags, defaults, exit codes — see
[`commands.md`](./commands.md).

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

`scai serialization watch` polls the GraphQL history endpoint for remote
changes and pulls deltas as they arrive. In CI, use `--timeout <seconds>`
to bound the loop:

```sh
scai serialization watch --timeout 1800
```

## Aliases

- `serialization` → `ser`
- `serialization package` → `pkg`
