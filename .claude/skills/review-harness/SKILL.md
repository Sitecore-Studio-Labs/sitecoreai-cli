---
name: review-harness
description: Audit harness health — memory staleness, skill drift, and convention coverage gaps. Trigger when the user asks to "review the harness", "audit memory", "check skill freshness", or "harness health".
---

# Review harness

Audit the agent harness for drift and staleness. Produces a single markdown
report at `plans/harness-review-YYYY-MM-DD.md`.

## What this skill checks

Two things: **memory accuracy** and **skill drift**.

### 1. Memory staleness

Read every `.md` file in the memory directory (under
`~/.claude/projects/-Users-nels-Projects-sitecoreai-deploy-sync-cli/memory/`,
once that directory exists).

**Project memories** — check each claim against current state:

| Signal                                           | How to verify                                                 | Verdict                                          |
| ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------ |
| References a plan file                           | `ls plans/<name>.md`                                          | `STALE` if file is gone                          |
| Says work is "planned" / "blocked" / "in-flight" | Check git log + code for evidence it shipped or was abandoned | `STALE` if landed or dead                        |
| Includes a date older than 30 days               | Read the memory                                               | `REVIEW` — may still be valid, flag for operator |

**Feedback memories** — check for redundancy:

| Signal                                               | How to verify                                                          | Verdict                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Rule now enforced by an ESLint rule, schema, or hook | Grep `eslint.config.js`, `src/config/*.schema.json`, `.claude/hooks/*` | `REDUNDANT` — automation is source of truth |
| References a file path that no longer exists         | Glob for the path                                                      | `DRIFT` — update or remove                  |

**Example finding:**

```
STALE: project_recipe_compiler.md
  Says "in-flight, IR backend partially done" but the IR backend
  shipped in commit abc1234 on 2026-04-15 and lives at src/recipe/.
  Action: update status to "shipped" or remove.
```

### 2. Skill drift

Read every `.claude/skills/*/SKILL.md`.

For each skill, extract file paths and symbol names, then verify:

| What to check                           | How                                    | Verdict                         |
| --------------------------------------- | -------------------------------------- | ------------------------------- |
| File paths (`src/...`)                  | Glob for exact path                    | `DRIFT` if missing              |
| Function/type/const names               | Grep in `src/`                         | `DRIFT` if missing              |
| Step assumes a file structure           | Read the file, check structure matches | `OUTDATED` if structure changed |
| References dependencies in package.json | Check current package.json             | `OUTDATED` if dep removed       |

**Example finding:**

```
DRIFT: codebase-conventions/SKILL.md
  References `ajv-draft-04` in dependencies list (line 35)
  but the dep was removed when we migrated to Zod for IR validation.
  Action: update the dep list and the surrounding sentence.
```

## Output format

Write findings to `plans/harness-review-YYYY-MM-DD.md`:

```markdown
# Harness review — YYYY-MM-DD

## Memory (X files checked)

- [verdict] filename.md — one-line finding + proposed action
- OK: 5 files, STALE: 1, DRIFT: 0, REDUNDANT: 1

## Skills (X skills checked)

- [verdict] skill-name — one-line finding + proposed action
- OK: 2, DRIFT: 1, OUTDATED: 0

## Suggested actions (priority order)

1. [now] Remove/update stale memory X — reason
2. [next] Fix drift in skill Y — reason
```

## Rules

- **Do not edit** memory or skills directly. Write the report; operator
  decides what to act on.
- **Be specific.** Include the file, the claim, the evidence, and the
  proposed action.
- **If everything is healthy, say so.** A clean report is a good report.
  Don't invent findings.
- **One report per run.** If a report already exists for today, overwrite it.
