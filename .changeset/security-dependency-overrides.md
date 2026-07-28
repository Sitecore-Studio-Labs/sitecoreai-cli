---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Security: bump vulnerable transitive dependencies to their patched versions and
refresh `package-lock.json` (which had drifted behind `pnpm-lock.yaml` and was
the tree Dependabot flagged). Clears all open advisories — `npm audit` and
`pnpm audit` both report zero.

- `js-yaml` → `^4.3.0` (quadratic-CPU merge-key parsing)
- `fast-uri` → `^3.1.4` (host confusion via literal backslash authority)
- `hono` → `^4.12.27` (header de-dup drop) and `@hono/node-server` → `^2.0.5`
  (Windows path traversal via encoded backslash)
- `postcss` → `^8.5.18` (source-map path traversal)
- `body-parser` → `^2.2.3` (DoS on invalid limit)
- `@modelcontextprotocol/sdk` → `^1.30.0` (pulls the patched `@hono/node-server`)

All are behavior-preserving version bumps within their current major; no source
or public API changes.
