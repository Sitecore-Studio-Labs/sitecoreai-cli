# Release

scai uses [Changesets](https://github.com/changesets/changesets) for
versioning and release automation. The `dev` branch is the integration
branch; merging `dev` → `main` triggers the release workflow.

## Local workflow

Add a changeset for any user-facing change:

```sh
pnpm changeset
```

- Select the bump type (patch / minor / major).
- Write a one-line summary aimed at the changelog reader.
- Commit the generated `.changeset/*.md` file with the code change.

## CI workflow

- Push to `main` triggers `.github/workflows/release.yml`, which opens a
  "Version Packages" PR via the Changesets action.
- Reviewing and merging that PR publishes to npm.
- Publish uses GitHub OIDC Trusted Publishing — no long-lived `NPM_TOKEN`.
- npm provenance is currently disabled while the repo is private; it will
  be re-enabled when the repo goes public.

## Manual release (rare)

```sh
pnpm version
pnpm release
```

`pnpm release` runs `tsc + tsc-alias` then `changeset publish`.

## Pre-flight checklist

Before merging the release PR, confirm:

- [ ] `pnpm check` is green (`format:check` + `lint` + `typecheck` + `test`)
- [ ] `pnpm smoke` passes (build + spawn-based smoke checks)
- [ ] `pnpm pack --dry-run` shows the expected file list (see
      [`quality-gates.md`](./quality-gates.md#packaging--artifacts))
- [ ] `dist/config/*.schema.json` is present in the dry-run output
- [ ] CHANGELOG.md reads correctly for the bumped version
- [ ] `main` branch protection still requires CI checks + review

## Post-publish smoke

After publish:

```sh
pnpm dlx @sitecoreai-labs/sitecoreai-cli --version
pnpm dlx @sitecoreai-labs/sitecoreai-cli --help
```

A full functional smoke check is what `pnpm smoke` does in CI (and it
runs on macOS, Linux, and Windows via `.github/workflows/smoke.yml`).

## Where the gates are enforced

For a single-page map of every quality gate and where it's enforced
(lint, typecheck, tests, secret scanning, lockfile hygiene, etc.), see
[`quality-gates.md`](./quality-gates.md).
