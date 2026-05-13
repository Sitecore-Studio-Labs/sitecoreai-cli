# Roadmap

Near-term improvements. Larger architectural shifts live in GitHub
issues/milestones, not here — this file is a quick-glance "what's in
flight" for new contributors.

## Near-term

- Config/schema enforcement for module configs loaded from packages.
- A `doctor` command to validate env/auth/config and surface actionable
  fixes.
- Configuration options for `sitecoreai.cli.json` storage location
  (currently fixed at the project root with `--config` as the override).

## CI and release

- CI preflight checks for publish credentials, org access, and release
  gating.
- Re-enable npm provenance when the repo goes public (see
  [`release.md`](./release.md)).

## Telemetry UX

- Persisted defaults and clearer status output for telemetry opt-in/out.
