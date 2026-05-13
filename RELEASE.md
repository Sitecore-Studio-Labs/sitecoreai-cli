# Release Checklist

Use this checklist before publishing the CLI.

## Pre-flight

- [ ] Confirm `sitecoreai.cli.json` schema is published with `envProfiles/defaultEnvProfile`.
- [ ] Ensure README and examples reference `envProfiles`.
- [ ] Verify telemetry endpoint and schema URL are correct.
- [ ] Confirm `bin/sitecoreai-cli` is executable and `scai` alias works.
- [ ] Confirm `main` is protected and requires CI checks + review

## Tests

- [ ] `npm test`
- [ ] `npm run test:integration` (optional; requires env vars and write-safe env)

## Versioning

- [ ] `npm run changeset`
- [ ] `npm run version`
- [ ] Review changelog and package version bump

## Publish

- [ ] `npm run release`
- [ ] Confirm npm provenance is enabled (release workflow sets `NPM_CONFIG_PROVENANCE=true`)
- [ ] Validate install: `npm i -g @sitecoreai-labs/sitecoreai-cli`
- [ ] Smoke test: `scai --help`, `scai status`, `scai init --wizard`
