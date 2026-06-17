---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Maintenance & hardening pass (no public API changes):

- **Security:** remediated a `js-yaml` quadratic-complexity DoS pulled in transitively via `@changesets/cli` (override `read-yaml-file` → v2; `npm audit` clean), and fixed 22 CodeQL findings — polynomial-ReDoS in path/slug/marker regexes (replaced with linear trims and bounded patterns), incomplete YAML/markdown/XML escaping, an HTML→ProseMirror sanitization bypass + double-unescape, and stack-trace exposure in the MCP HTTP error path.
- **Maintainability:** behavior-preserving refactors cutting every cyclomatic-complexity and nesting outlier below threshold across recipe compile/validate/pull/push, the campaign/brief/brand sync kinds, env init/auth/status, hygiene cleanup, and workflow/deploy/mcp/publishing tasks; high-arity internal helpers moved to options objects.
- **Tooling:** complexity guardrails are now a two-tier lint ratchet — hard `error` ceilings that block regressions, plus a non-blocking `lint:complexity-debt` worklist to chip the remainder down over time.
