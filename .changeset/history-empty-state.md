---
"@sitecoreai-labs/sitecoreai-cli": patch
---

**`scai cli history` no longer prints nothing on an empty log.** When
the history log file existed but was empty, the command produced zero
output and exited 0 — indistinguishable from a broken command. It now
prints `No CLI history recorded yet — log file: <path>`.

A missing log file is treated the same as an empty one (previously a
`WARN`, now the same empty-state message), and `--json` emits `[]`
instead of nothing when there are no entries.
