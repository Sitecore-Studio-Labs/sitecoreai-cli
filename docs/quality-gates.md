# Quality gates

A living map of _where_ each gate is enforced. Readers can verify status by
looking at the enforcement point rather than trusting a date.

When a gate is added, removed, or moved: update the corresponding row here.
This file is informational — it does not gate releases. CI does.

## Quality

| Gate                     | Enforced by                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Lint                     | `pnpm lint` (eslint.config.js) — runs in `.github/workflows/ci.yml`                 |
| Typecheck                | `pnpm typecheck` (`tsc --noEmit`) — runs as `pretest`; CI                           |
| Unit + integration tests | `pnpm test` (vitest) — CI; integration tier gated on `SITECOREAI_RUN_INTEGRATION=1` |
| Build                    | `pnpm build` (tsc + tsc-alias) — `prepack` + CI                                     |

## Dependency & supply chain

| Gate                   | Enforced by                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| No known runtime vulns | Run `pnpm audit --omit=dev` ad-hoc; not currently CI-gated           |
| License policy         | Run `pnpm dlx license-checker --summary` ad-hoc; org-policy decision |
| Lockfile hygiene       | `pnpm-lock.yaml` committed, `.pnpm-store/` gitignored                |

## Packaging & artifacts

| Gate                 | Enforced by                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| Tarball contents     | `pnpm pack --dry-run` — verify before publish                                 |
| Schema files shipped | `dist/config/*.schema.json` produced by `tsc` (verified manually pre-publish) |
| Husky / `prepare`    | Husky disabled in publish CI via `HUSKY=0`                                    |

## Security & secrets

| Gate                     | Enforced by                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| History redacts CLI args | `src/shared/redact.ts`; covered in `tests/unit/shared/redact.test.ts`  |
| No hardcoded credentials | `.github/workflows/secret-scan.yml` (gitleaks) — fails CI on detection |
| Auth/credential storage  | `src/shared/keychain.ts` (system keychain) — covered in unit tests     |

## Reliability & networking

| Gate                              | Enforced by                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GraphQL timeout + status handling | `src/shared/graphql.ts` (shared transport) — unit + integration tests                                         |
| Telemetry retries + schema        | `src/shared/telemetry.ts`                                                                                     |
| Retry/backoff strategy            | Deploy API retries idempotent GETs; GraphQL POSTs not retried (intentional, to avoid silent duplicate writes) |
| CliError contract                 | `src/shared/errors.ts` — every code maps to a stable exit code; covered in `tests/unit/shared/errors.test.ts` |

## Compatibility & runtime

| Gate               | Enforced by                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Node engine        | `package.json` `engines.node: ">=20"`                                                                         |
| OS matrix          | `.github/workflows/smoke.yml` — runs `pnpm smoke` on macOS/Windows/Linux                                      |
| Headless / non-TTY | Smoke workflow runs in CI (no TTY); `cli.ts` falls back to non-interactive mode when stdin/stdout aren't TTYs |

## Documentation & governance

| Gate                          | Enforced by                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| README accuracy               | Manually maintained; PRs touching public surface should update it                                                    |
| Agent contract                | [`../AGENTS.md`](../AGENTS.md) — `--json`, `--non-interactive`, `SITECOREAI_AUTO_WIZARD=0` are stable invariants      |
| Command reference             | [`commands.md`](./commands.md) is generated from the Commander tree via `pnpm docs:commands`                         |
| Telemetry / history retention | [`telemetry-and-privacy.md`](./telemetry-and-privacy.md) — data-handling decisions live with the operator            |

## Release process

| Gate               | Enforced by                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| Changesets         | `pnpm changeset` — required for any user-facing change                  |
| Publish provenance | `.github/workflows/release.yml` (currently disabled while repo private) |
| Trusted publishing | OIDC via npm Trusted Publishing — no long-lived `NPM_TOKEN`             |
| Branch protection  | `.github/workflows/branch-protection.yml` enforces protection on `main` |

## What this file is not

- Not a release gate — CI gates releases.
- Not a status report — the truth is in the enforcement points above.
- Not a one-time pre-launch audit — that was 2026-02-04; if you need a
  fresh audit, run one and write a separate dated note.
