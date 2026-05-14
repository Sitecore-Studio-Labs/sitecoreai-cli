---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai recipe push`: rollback compensating-op audit log on disk.**
When an apply phase aborts (op error, plan-time error, or mid-flight
cancel), the executor unwinds applied actions LIFO. Previously the
only record of what rollback did or failed at lived in the
in-memory `ExecutionFailedEvent.rollbackErrors` count, surfaced as a
single warn line. Operators couldn't audit which items rollback
failed on after the process exited — and "best-effort" failures leave
zombie state on the tenant that you genuinely need to chase.

Every `recipe push` invocation now generates a `runId` and (lazily)
writes a JSONL file at:

```
~/.sitecoreai/rollback/<runId>.jsonl
```

Override the directory via `SITECOREAI_ROLLBACK_LOG_DIR`. The file is
only created on first append, so successful pushes leave nothing
behind. Each line is `{ v, ts, runId, kind, recipe, … }`:

- One `step` line per compensating op with `status` (`success` /
  `skip` / `failed`), `inverse` (`deleteItem` / `updateItem`), the
  captured `itemId` (so you can replay the rollback manually), and
  `error` / `reason` when applicable.
- One `summary` line per recipe with the `trigger`
  (`apply-error` / `plan-error` / `cancelled`), `rolledBack` count,
  `errorCount`, and the upstream `forwardError`.

Error and reason fields run through `redactSecrets` before write.

The log path surfaces in two places:

- **Human mode:** a `logger.warn` line after the push completes,
  printed only when at least one line was written.
- **`--json` mode:** a new optional `rollbackLog: { runId, path }`
  field on the top-level envelope, omitted entirely when unused.

Schema version pinned at `v: 1` for future tooling that wants to
parse the log.
