---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`cli`: drain stderr alongside stdout on force-exit.

The force-exit path drained only stdout before calling `process.exit`.
Parent processes that captured stderr — the orchestrator's recipe-sync
workers do, to surface scai exit details — could lose the trailing log
line, most visibly the error message the `runCli` catch block prints
right before exit. Adding a symmetric stderr drain after the stdout
drain makes both streams flush before the process tears down.

No behavior change for callers that consume stdout only or that read
both streams via line buffering.
