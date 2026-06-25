---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(deploy): drop unreliable server-side Types filter when listing environments

The Deploy API's server-side `Types` filter silently drops valid environments
(a `Types=cm` request returned 3 of an org's 10 CM environments).
`runDeployEnvironmentsList` no longer sends the server-side hint and narrows
client-side via `filterEnvironmentsByType`, which is exact. Also removes the
now-dead empty-result re-fetch fallbacks and fixes a raw-result leak in the
single-page branch.
