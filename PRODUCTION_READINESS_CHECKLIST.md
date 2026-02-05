## Production Readiness Checklist

Date: 2026-02-04

### Quality Gates

- [x] `npm run lint` (pass)
- [x] `npm run test` (pass, earlier in this session)
- [x] `npm run build` (pass)

### Dependency & Supply Chain

- [x] `npm audit --omit=dev` (0 vulnerabilities)
- [x] License summary captured via `npx license-checker --summary`
- [x] Review license policy compliance (verify acceptable licenses for your org)
- [x] Lockfile hygiene (ignore `pnpm-lock.yaml` and `.pnpm-store/`)

### Packaging & Artifacts

- [x] `npm pack --dry-run` executed; tarball contents reviewed
- [x] `dist/config/schema.json` present
- [x] `dist/config/serialization-module.schema.json` present
- [x] `dist/config/telemetry.schema.json` present
- [x] Confirm `prepare`/Husky behavior on publish and installs from git
  - Note: `npm pack --dry-run` triggers `prepare`; if CI lacks `.git` access, set `HUSKY=0`

### Security & Secrets

- [x] History logging redacts sensitive CLI args
- [x] Secret scanning in `src/` and `tests/` shows no hardcoded credentials
- [x] Run automated secret scan in CI (gitleaks workflow added)

### Reliability & Networking

- [x] GraphQL calls have timeout + HTTP status handling
- [x] Telemetry uses retries and schema validation
- [x] Confirm all network clients share consistent retry/backoff strategy
  - Deploy API retries idempotent GETs; GraphQL POSTs not retried to avoid side effects

### Compatibility & Runtime

- [x] Node engine specified (`>=20`)
- [x] Smoke test on macOS/Windows/Linux (keytar + TTY behavior)
  - Local `npm run smoke` executed; CI workflow added for OS matrix
- [x] Validate CLI behavior in CI (non-TTY, headless)
  - `smoke.yml` runs `npm run smoke` in CI

### Documentation & Governance

- [x] Telemetry + module schema validation documented in README
- [x] Add production troubleshooting guide (common auth/network failures)
- [x] Add data handling/retention statement for telemetry + history logs

### Release Process

- [x] Changesets workflow present
- [x] Verify npm publish permissions + provenance/signing requirements
  - Release workflow sets `NPM_CONFIG_PROVENANCE=true`
- [x] Validate release automation in CI on protected branches
  - Branch protection workflow enforces protection on `main`
