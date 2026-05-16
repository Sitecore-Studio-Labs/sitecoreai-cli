---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai publish` + `scai content version` — publishing surface shipped.**
First-class wrapper around the SAI Publishing REST API
(`edge-platform.sitecorecloud.io/authoring/publishing/v1`) with a
two-step safety flow on every write.

**Publishing verbs:**

- `scai publish item` — item / subtree publish. Address by
  `--items <guid>`, `--paths <path>`, or `--site <name>` (composable).
  `--include-subitems` / `--include-related` for the dotnet `--subitems`
  / `--related` equivalents. `--mode Smart|Republish`.
- `scai publish all` — whole-environment republish to Edge. Modes
  `Smart` (default) / `Republish` / `Incremental`. Maximum gating:
  always requires a scope token AND typed env-name confirmation, even
  on non-prod envs. In `--non-interactive` mode, auto-watches the job
  to completion and exits with the appropriate code (pass `--no-wait`
  to override). Dry-run surfaces the last whole-env publish timestamp
  and itemsSent count as a "modified since" baseline.
- `scai publish unpublish` — three strategies: `never-publish`
  (reversible, default, writes `__Never publish: true`),
  `expire-now` (reversible, writes `__Valid to: <now>`), and
  `delete` (NOT reversible; requires typed-item-path confirmation per
  item).
- `scai publish status [<jobId>]` — one-shot status, list queued/running
  jobs, or `--watch` to poll until terminal. Exits 0 on completed, 6 on
  failed, 130 on cancelled, 4 on watch timeout. JSON streaming for CI.
  Failed jobs surface structured failure diagnostics (reason,
  per-item errors).
- `scai publish cancel <jobId>` — cancel a single job, or
  `--all-queued` to sweep the env (gated by typed env-name
  confirmation).
- `scai publish history` — JSONL-friendly reader for the local audit
  log (`~/.sitecoreai/audit.log`), with `--env --since --command
--outcome --limit` filters.

**Companion content-state verbs (`scai content version *`):** inspect,
set-validity (`__Valid from`/`__Valid to`), set-never-publish. These
mutate CM-side fields that affect what `scai publish` picks up; living
under `content` (not `publish`) since they're content mutations, not
publish operations.

**Auth model:** publishing requires an **environment-level** automation
client (carries `xmcpub.jobs.t:r`, `xmcpub.jobs.t:w`, `xmcpub.queue:r`
scopes), not the org-level client used by other scai surfaces. scai
mints + caches the publishing-scoped JWT transparently via the
keychain, with stale-cache fallthrough (re-mint when cached token's
scopes drift or it's inside a 60s expiry safety margin).

**Safety design (non-negotiable):**

- `--what-if` default on every mutating verb.
- 5-minute scope tokens bound over (envName, resolved tenant, item IDs,
  languages, target). Scope drift invalidates the token.
- Production-tier envs gate writes behind `--confirm-token` from a
  prior dry-run. Non-prod accepts `[y/N]` or `--yes`.
- Append-only audit log at `~/.sitecoreai/audit.log` with scope hash,
  scope token, jobId, outcome, and per-field before/after for content-
  state mutations.
- Whole-environment `publish all` is treated as max-risk regardless of
  prod flag — typed env-name confirmation required.
- MCP surface: read-only `publish_inspect` (status/list-running/history)
  and cancel-only `publish_lifecycle`. Submission verbs are
  intentionally CLI-only — the consent token model requires a
  human-driven dry-run that the agent cannot synthesize.

**Auto-resolve defaults:** locale flags are mutually exclusive
(`--languages`, `--languages-from-site`, `--all-tenant-languages`).
When none is set, scai auto-resolves tenant-wide languages and logs
the resolved set ("auto-resolved tenant-wide; pass --languages to
override"). The Publishing API has no implicit default — empirically
verified.

**Naming note documented inline:** the API field `xmc.site.mode` is
whole-_environment_, not whole-_site_ (legacy XM terminology from when
one Sitecore instance == one site == one DB). Empirically verified
2026-05-14 — a Smart-mode `publish all` against a real env considered
~17K items across every site, with no API surface accepting a site
identifier. To publish a single Sitecore site, use
`scai publish item --site <name> --include-subitems`.

See `docs/publish-walkthrough.md` for copy-pasteable runbooks,
`docs/parity-with-devex.md` for the dotnet mapping + safety design
rationale, and `docs/roadmap.md` for the open roadmap items.
