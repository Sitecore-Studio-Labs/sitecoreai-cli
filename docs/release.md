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
- npm provenance is **enabled** (`NPM_CONFIG_PROVENANCE: true` on both the
  `release` and `canary` publish steps). Every published version carries a
  signed attestation linking it to the commit and workflow that built it.

### Provenance

Provenance needs two things: OIDC Trusted Publishing (already the auth
path) and a **public** source repo. The repo is public, so both hold.

Verify a published version:

```sh
npm audit signatures
```

The npm package page also shows a **Provenance** section listing the
source commit and the workflow that published it.

Two things to know before touching this:

- **Never run `npm install -g npm@latest` in the release or canary job.**
  It replaces the node-bundled npm with a copy that has no bundled
  `sigstore` module, and provenance generation dies with
  `MODULE_NOT_FOUND Cannot find module 'sigstore'`. Node 24's bundled npm
  is already ≥ 11.5.1 and supports both Trusted Publishing and provenance.
- **Attestations are permanent and per-version.** They are written to
  Sigstore's public transparency log — repo URL, commit SHA, workflow path
  — and cannot be retracted once a version ships. Appropriate for a public
  repo; just not undoable. Turning provenance off later stops _future_
  versions from being signed, it does not unpublish past attestations.

## Canary releases (pre-release testing)

To get a fix in front of testers before it is official, publish a
**canary** build. A canary is a snapshot version
(e.g. `0.1.2-canary-20260519123456`) published under the npm `canary`
dist-tag — it never moves `latest`, never tags git, and never writes the
changelog.

Trigger it manually from the **Release** workflow — GitHub → Actions →
Release → **Run workflow** (pick the branch, usually `dev`), or:

```sh
gh workflow run release.yml --ref dev
```

The `canary` job runs the full gate (lint + test + build + smoke), then
`changeset version --snapshot canary` + `changeset publish --tag canary`.
It requires at least one pending `.changeset/*.md` file — the canary
version is calculated from the bump those changesets describe.

Testers install the canary instead of the stable release:

```sh
npm i -g @sitecoreai-labs/sitecoreai-cli@canary
scai --version    # 0.1.2-canary-...
```

A canary does **not** consume the changeset: the same `.changeset/*.md`
files still flow through the stable `dev` → `main` release and become the
official version on `latest`. There is nothing to "promote" — cutting the
real release is the unchanged flow above.

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
