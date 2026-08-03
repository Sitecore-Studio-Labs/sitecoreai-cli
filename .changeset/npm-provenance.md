---
"@sitecoreai-labs/sitecoreai-cli": patch
---

npm provenance is enabled. Published versions now carry a signed attestation linking the tarball to the commit and workflow that built it — verify with `npm audit signatures`, or read the Provenance section on the npm package page.

Provenance needs a public source repo on top of the OIDC Trusted Publishing that was already wired; the repo is now public, so the one condition holding it back has cleared. `NPM_CONFIG_PROVENANCE: true` is set on both the `release` and `canary` publish steps, so a canary verifies exactly the way a stable release does.

Note for maintainers: attestations go to Sigstore's public transparency log and are permanent and per-version — appropriate for a public repo, but not retractable. And do not add `npm install -g npm@latest` to either publish job: it replaces the node-bundled npm with a copy that has no bundled `sigstore` module, and provenance generation then fails with `MODULE_NOT_FOUND`.
