# Using scai from an agent or CI

This file is the contract for AI agents and CI pipelines that drive
`scai`. It complements [README.md](./README.md) (which targets human
operators) and [CLAUDE.md](./CLAUDE.md) (which targets agents _working on_
this repo, not _using_ the CLI).

The agent-facing surface is a deliberately small set of flags and env
vars that are guaranteed not to silently change across releases.

## The contract

- `--non-interactive` disables every prompt. Auto-detected when stdin or
  stdout aren't TTYs; explicit flag wins.
- `--json` writes machine-readable output to stdout and nothing else
  (banner, spinners, hints are suppressed).
- `--quiet` suppresses non-error output. Compose with `--json` when
  parsing.
- `--log-file <path>` writes the full log to a file regardless of stdout
  mode.
- `SITECOREAI_AUTO_WIZARD=0` disables the first-run wizard. Always set
  this in CI.
- `--what-if` (where supported) prints the resolved API call and payload
  without executing it. Safe to use on any write surface.
- `--config <path>` points at a `sitecoreai.cli.json` outside the
  project root.
- `--environment-name <name>` selects an env profile (aliases: `-n`,
  `--env`, `--env-name`).

Exit codes are stable and meaningful:

| Code | Meaning                      |
| ---- | ---------------------------- |
| `0`  | Success                      |
| `2`  | Configuration or input error |
| `3`  | Authentication required      |
| `4`  | Network error                |
| `5`  | Environment not found        |
| `6`  | Deploy failure               |

If a script needs to branch on a specific failure, branch on the exit
code — error _messages_ may evolve, codes will not.

## Authentication

| Flow               | Required inputs                                                              | TTY needed? |
| ------------------ | ---------------------------------------------------------------------------- | ----------- |
| Deploy token       | `--deploy-token` or `SITECOREAI_DEPLOY_TOKEN`                                | No          |
| Client credentials | `--use-client-credentials` + `--client-id` + `--client-secret` (or env vars) | No          |
| Device login       | TTY + browser access                                                         | Yes         |

The Deploy token covers both Deploy API and CM/admin scopes — one token
for the whole agent contract. See [docs/configuration.md](./docs/configuration.md#authentication)
for token storage details (OS keychain).

## Recipes (preview — graduates in 0.1.0)

The `recipe` command group is present in the source tree but **un-advertised**
in 0.0.x — neither `package.json` `exports` nor `scai --help` surface it. It
graduates in the 0.1.0 release; the parked changeset under
`.changeset-parked/` describes the surface coming online.

When `scai provision recipe` runs (today via internal code paths, in 0.1.0 via the
`scai provision recipe compile|plan|diff|push` commands), it loads `.recipe.ts` files
through the `tsx` runtime. **These files are executed code, not data.**

> **`.recipe.ts` files are executed code, not data.** When you run any
> `scai provision recipe` command (including `recipe diff` and `recipe push --what-if`),
> every matched `.recipe.ts` file is imported and its top-level code runs
> with the full privileges of your shell — including filesystem access,
> network, and environment variables. Treat recipe files like any other
> build script (e.g. `webpack.config.js`, `vite.config.ts`): only run
> `scai provision recipe` against repos and recipe files you trust. If you need to
> inspect an untrusted recipe set, compile it to `.recipe.json` in a
> sandboxed environment first and operate on the JSON form.

This trust model also belongs in the user-facing README's Recipes section
when 0.1.0 ships; track that integration in the release PR.

## Examples

### Serialization push in CI

```sh
scai provision serialization push \
  --environment-name ci \
  --non-interactive \
  --json \
  --allow-write
```

### Deploy environments list in CI

```sh
scai provision deploy environments list \
  --project "<project-id>" \
  --environment-name ci \
  --non-interactive \
  --json
```

### Watching a deployment with a bounded timeout

```sh
scai provision deploy deployments watch --id <deployment-id> --timeout 3600
```

Without `--timeout`, watch loops forever. Always bound them in CI.

### Dry-run a deploy command

```sh
scai provision deploy environments create \
  --project "X" --name "Y" --cm-only \
  --what-if
```

`--what-if` prints the request that _would_ be made and exits 0 without
side effects. Use this to validate flag combinations from a script before
you flip to a real run.

## Common sources of confusion

- **`--environment-name` is a config profile**, not a Deploy API
  environment. The Deploy API uses `--name`/`--id`.
- **Project source-control ID mapping is asymmetric** between create
  (`integrationId`) and update (`sourceControlIntegrationId`) — see
  [docs/deploy.md](./docs/deploy.md#selection-rules).
- **CM-only environments** expect `xmcloud.build.json` with `buildTargets`
  and `authoring` settings. See
  [docs/deploy.md](./docs/deploy.md#cm-only-environments-and-editing-hosts).
- **Writes require `allowWrite: true`** in the environment config. Set
  via `SITECOREAI_ENV_<NAME>_ALLOW_WRITE=true` or `--allow-write` on a
  per-call basis.

## Machine-readable surface

- [`agent.json`](./agent.json) — agent metadata and skill inventory.
- [`skills/`](./skills/) — bundled Cursor-style skills with usage
  recipes per concern (serialization, deploy, troubleshooting, …).
- [`docs/commands.md`](./docs/commands.md) — full Commander tree,
  regenerated from source via `pnpm docs:commands`.

For deeper docs:

- [docs/configuration.md](./docs/configuration.md) — config file, env
  vars, profiles
- [docs/serialization.md](./docs/serialization.md) — SCS pull/push/diff
- [docs/deploy.md](./docs/deploy.md) — Deploy API surface
- [docs/telemetry-and-privacy.md](./docs/telemetry-and-privacy.md) —
  opt-out and data handling
