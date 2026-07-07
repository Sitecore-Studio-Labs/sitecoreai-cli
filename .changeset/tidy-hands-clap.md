---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`recipe push` can now report live per-recipe progress for orchestrators. With `SITECOREAI_PROGRESS_STREAM=1`, the push writes one compact NDJSON line to stderr as each recipe finishes applying (`{"scaiProgress":1,"recipe":"page-home@1","index":12,"total":237,"status":"succeeded","summary":{...}}`) — machine-readable movement for drivers that run the push with `--json` (which suppresses the human per-recipe log). stderr keeps the `--json` stdout envelope parseable; the stream is off by default and plain CLI runs are unaffected.
