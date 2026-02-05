# Contributing to SitecoreAI CLI

Thanks for your interest in contributing! This guide explains how to get set up,
run checks, and submit changes.

## Pre-requisites

- Node.js (Active LTS or newer; see `package.json` for the minimum version).
- npm (>= 9).

## Developing

1. Fork the repository to your own GitHub account and clone it locally.
2. Create a new branch for your work (for example `feature/my-change`).
3. Make your changes and add tests when appropriate.
4. Open a Pull Request targeting the default branch of this repository.

## Setting up

From the repo root:

```shell
npm install
```

Common tasks:

```shell
npm run build
npm run lint
npm run test
```

## Code style and linting

We use ESLint and Prettier. Please keep your changes formatted and linted:

```shell
npm run format
npm run lint
```

You can auto-fix lint issues:

```shell
npm run lint:fix
```

## Testing

Unit tests:

```shell
npm run test
```

Integration tests (require environment variables):

```shell
npm run test:integration
```

You can define integration env vars in `.env.test.local` (see `.env.example` for
the supported variables).

### Test layout conventions

- `tests/unit/**` mirrors `src/**` (for example, `src/serialization/tasks/*` →
  `tests/unit/serialization/tasks/*`).
- Prefer descriptive filenames aligned to the feature area, e.g.
  `serialization/tasks/deploy.test.ts`.
- Integration tests live in `tests/integration/` and use the
  `*.integration.test.ts` suffix.

## Changesets (versioning)

This repo uses Changesets for versioning and releases. If your change affects
the published package, add a changeset:

```shell
npm run changeset
```

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
