# Contributing to scai

Thanks for your interest! This guide is for working on the **scai** repo
itself. If you're just _using_ the CLI, see [README.md](./README.md).

## Pre-requisites

- Node.js >= 20 (see `package.json` `engines.node`).
- `pnpm` >= 9 — this repo is a pnpm workspace. Don't use `npm`, `yarn`,
  or `bun` for repo work. End-user installs can use any package manager,
  but the repo's dev tooling assumes pnpm.

## Setup

```sh
pnpm install
```

## Common tasks

```sh
pnpm dev -- <command>          # run the CLI against your local source
pnpm build                      # tsc + tsc-alias → dist/
pnpm lint                       # eslint
pnpm typecheck                  # tsc --noEmit
pnpm test                       # vitest unit tests
pnpm test:integration           # vitest integration tests (gated, see below)
pnpm check                      # format:check + lint + typecheck + test
pnpm docs:commands              # regenerate docs/commands.md from source
```

The single gate that mirrors CI is `pnpm check`.

## Workflow

1. Fork or branch from `dev` (the integration branch).
2. Make your change with tests.
3. Add a changeset (`pnpm changeset`) for any user-facing surface change.
4. Open a PR against `dev`.

`dev` → `main` is the publish path. See [docs/release.md](./docs/release.md)
for the release process.

## Code style and linting

ESLint + Prettier. Keep changes formatted and linted:

```sh
pnpm format         # prettier --write
pnpm format:check   # prettier --check (what CI runs)
pnpm lint           # eslint
pnpm lint:fix       # eslint --fix
```

## Tests

- Unit tests live in `tests/unit/**` mirroring `src/**`
  (`src/serialization/tasks/*` → `tests/unit/serialization/tasks/*`).
- Integration tests live in `tests/integration/` with the
  `*.integration.test.ts` suffix.
- Integration tests are **gated** by `SITECOREAI_RUN_INTEGRATION=1`; they
  hit real Sitecore APIs and need credentials. Define env vars in
  `.env.test.local` (see [.env.example](./.env.example)).

For the full testing convention — what to mock, what to hit live, how to
structure new test files — see [.claude/skills/testing-conventions/](./.claude/skills/testing-conventions/SKILL.md).

## When you add a command

The repo expects a specific shape for new commands. See
[.claude/skills/codebase-conventions/](./.claude/skills/codebase-conventions/SKILL.md)
for the full checklist. Quick version:

1. Parser in `src/commands/<group>/<name>.ts`.
2. Runner in `src/<group>/tasks/<name>.ts`.
3. Unit test mirroring the source path.
4. Integration test if it hits a real API.
5. `pnpm changeset` for the user-facing surface change.
6. `pnpm docs:commands` to regenerate the command reference.

## Code of Conduct

By participating, you agree to abide by the
[Code of Conduct](./CODE_OF_CONDUCT.md).
