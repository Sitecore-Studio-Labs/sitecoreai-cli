# Agent Guidelines

This document is for agents assisting with the **SitecoreAI Deploy & Sync CLI**. It focuses on how to
use the CLI, not how to develop the repository.

## Agent assets

- Machine-readable config: [`agent.json`](./agent.json)
- Skills index: [`skills/README.md`](./skills/README.md)
- Skill library: [`skills/`](./skills/)

## CLI Basics

- CLI name: `scai` (alias: `sitecoreai-cli`)
- Config file: `sitecoreai.cli.json` in the project root (use `--config` to point elsewhere)
- Default environment: `defaultEnvProfile` in `sitecoreai.cli.json`
- Command groups: `serialization` (alias: `ser`) and `deploy`

## Common Commands

Configure an environment:

```
npm run dev -- init --environment-name demo --cm https://<cm-host>
```

Use `--skip-deploy-lookup` to avoid Deploy API lookups and prompt for the CM host.

Check configured environments:

```
npm run dev -- status
```

Run serialization:

```
npm run dev -- serialization pull --environment-name demo
npm run dev -- serialization push --environment-name demo
```

Deploy API examples:

```
npm run dev -- deploy organizations get
npm run dev -- deploy projects list
npm run dev -- deploy environments list --project <id-or-name> --type cm
```

Interactive shell (TTY only):

```
npm run dev -- shell
```

## Authentication Notes

- Deploy API uses `deployToken` (stored per environment).
- Use `login` to refresh the SitecoreAI access token for an environment.
- Serialization uses the Management API and requires `authority` plus OAuth credentials.
- Set `authority`, `clientId`, `clientSecret`, and `useClientCredentials` in `sitecoreai.cli.json` when needed.

## Safety

- Writes require `allowWrite: true` in the environment config.
- Use `--what-if` on serialization commands to preview changes.
- In CI/non-TTY, prefer `--non-interactive` and set `SITECOREAI_AUTO_WIZARD=0`.
