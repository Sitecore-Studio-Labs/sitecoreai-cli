---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**New verb: `scai topics` — intent-based command index for discoverability.**

The feedback agent's diagnosis: "I spent an hour reinventing `audit
references`, `audit template-dependencies`, `audit site-residue`,
`cleanup subtree`, and `cleanup site-residue` — all of which exist."
The audit and cleanup help lists are alphabetical and described
one-line-per-command; if you don't already know the name of the
primitive you need, finding it via `--help` is a guess-and-grep loop.

`scai topics` is the curated index — commands grouped by _what
you're trying to do_, not where they live in the tree:

```
$ scai topics
scai topics — intent-based command index

  diagnose-blocked-delete
    Find out why a Sitecore item won't delete — what references hold it.
  clean-orphan-content
    Delete the residue left after a Sites-API site delete or a subtree-removal mistake.
  manage-known-debt
    Accept known-good findings into a per-env baseline so CI only flags new regressions.
  deduplicate-content
    Find and merge items with identical content hashes.
  pipeline-audit-cleanup
    Compose an audit + its cleanup in one shell pipeline to avoid running the same scan twice.
  automate-with-agents
    Run scai from an MCP-compatible agent host (Claude Code, Cursor, Windsurf, …).

Show one topic's commands: `scai topics <name>`
```

Expand a topic to see its commands in recommended-run order:

```
$ scai topics diagnose-blocked-delete
scai topics: diagnose-blocked-delete
  Find out why a Sitecore item won't delete — what references hold it.

  scai explain why-blocked <itemId>
    One-shot: run audit references + audit template-dependencies and merge the findings, sorted by kind

  scai audit references --to <itemId>
    Walk content fields for items whose value mentions the target (slow but broad)

  scai audit template-dependencies --template-id <itemId>
    Index-driven check for the five structural reference shapes (base-template, insert-options, …)
```

`--json` returns the same data as a canonical `ScaiEnvelope` for
agent consumption.

The topic list is **curated** — `src/commands/topics/index.ts`
hand-edits the groupings to reflect workflows ("why won't this
delete?"), not the directory layout. Cost: keeping the list in sync
when commands move. Payoff: a single entry point that catches
operators (and agents) before they reinvent a primitive that already
exists.

6 unit tests in `tests/unit/commands/topics.test.ts` lock slug
uniqueness, non-empty descriptions, and the presence of the three
topics most directly tied to the agent feedback (diagnose-blocked-
delete, manage-known-debt, pipeline-audit-cleanup).
