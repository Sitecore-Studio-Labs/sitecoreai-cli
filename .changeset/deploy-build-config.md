---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(deploy): `provision deploy build-config` — write/update xmcloud.build.json

Adds `scai provision deploy build-config`, which creates or updates
`xmcloud.build.json` (the XM Cloud Deploy build manifest a head app needs so the
Deploy service knows how to build + run its rendering/editing host). It adds or
updates one rendering-host entry (path, nodeVersion, jssDeploymentSecret, enabled,
type, install/build/run commands) and merges into any existing file — sibling
hosts, `postActions`, and unknown top-level keys are preserved. `--remove-default`
drops the OOTB `editing-host-name` host when adding a renamed one; `--what-if`
previews without writing. Pure file operation (no Deploy API call), so it pairs
with the Deploy API verbs when wiring a repo for deployment. Brings the manifest
generation that previously lived only in the orchestrator into the CLI.
