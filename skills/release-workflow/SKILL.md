---
name: release-workflow
description: Guide the release flow using changesets and npm provenance. Use when publishing, versioning, or preparing a release.
---

# Release Workflow

## Core commands

- Create changeset: `npm run changeset`
- Version bump: `npm run version`
- Publish: `npm run release`

## Checklist

- Ensure CI is green before release.
- Verify provenance settings in CI.
- Review `RELEASE.md` for current release steps.
