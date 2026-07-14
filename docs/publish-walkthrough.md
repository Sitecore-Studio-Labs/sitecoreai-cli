# Publishing walkthrough

Scenario-driven runbooks for `scai content publish`. Each section is a complete
copy-paste flow plus the why behind each step. Pair with the help text
in `scai content publish --help` for option-level detail.

## Prerequisite: env-level automation client

Publishing requires a **per-environment** automation client (not the
org-level client most other scai commands use). One-time setup:

1. Cloud Portal → Environments → [your env] → **Automation Clients** →
   **Create new client**. Give it a meaningful name (e.g. "scai content publish
   — sandbox").
2. Copy the `clientId` and `clientSecret`. The secret is shown only
   once.
3. Either add them to `sitecoreai.cli.json` under
   `envProfiles.<env>.clientId` / `.clientSecret`, or set
   `SITECOREAI_ENV_<NAME>_CLIENT_ID` / `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`
   in your shell. Per-env env vars override config and avoid committing
   the secret.
4. `scai content publish status -n <env>` smoke-tests the credentials — it
   doesn't write anything but it does mint a publishing-scoped JWT, so
   if scopes are wrong you'll get a clear error pointing to the missing
   `xmcpub.jobs.t:*` grant.

## Scenario 1: publish a single page

You changed one item under `/sitecore/content/MyTenant/marketing/Home`.

```sh
# Dry-run — prints scope + a 5-minute scope token. Nothing leaves CM.
scai content publish item --paths /sitecore/content/MyTenant/marketing/Home -n sandbox

# Real call — pass the token back. Non-prod envs prompt [y/N] unless --yes.
scai content publish item --paths /sitecore/content/MyTenant/marketing/Home \
  -n sandbox --allow-write --confirm-token <token>

# Watch the job to completion. Optional — submit logs jobId for later
# polling, or you can pass --watch above.
scai content publish status <jobId> -n sandbox --watch
```

The scope token (`pub_…`) is bound to the resolved scope (env, tenant,
items, languages, target). Changing any of those between dry-run and
real call invalidates the token — you'll get a fresh dry-run.

## Scenario 2: publish a whole site

The marketing team pushed a content campaign. You want to publish the
entire `marketing` site subtree.

```sh
# Resolves "marketing" → site root item → publishes root + subitems
scai content publish item --site marketing --include-subitems -n sandbox

scai content publish item --site marketing --include-subitems -n sandbox \
  --allow-write --confirm-token <token>
```

Without `--include-subitems`, only the site's root item is published —
useful for refreshing the site's settings without re-emitting every
descendant.

You can compose `--site` with literal item IDs / paths. The publish job
operates on the union of all targets.

## Scenario 3: republish the whole environment

After a big serialization push or a rollback, Edge has drifted from CM.
You need to re-emit everything in the env to the Edge target.

```sh
# Pre-flight: shows the last whole-env publish timestamp + sent count,
# so you have a "modified since" baseline before you commit to this.
scai content publish all --mode Smart -n sandbox

# Real call — Tier 2 max gating: --confirm-token AND typed env-name.
scai content publish all --mode Smart -n sandbox --allow-write \
  --confirm-token <token>
# (you'll be prompted to type "sandbox" verbatim before submission)
```

Modes:

- **Smart** (default) — only re-emit items modified since the last
  publish. Cheap. Right call for routine drift repair.
- **Republish** — force re-emit every item, regardless of last-publish
  state. Use after a serialization push that changed every item, or
  when you suspect Edge has a stale shape that Smart won't fix.
- **Incremental** — force re-emit every item _and_ re-process derived
  data (search indices, etc.). Slowest. Reach for it only after
  Republish doesn't fix the issue.

> **Naming note:** the underlying API field is `xmc.site.mode`. This
> is legacy XM terminology — when one Sitecore instance == one site ==
> one DB, "publish site" meant "publish everything in the master DB."
> In XM Cloud, this operates on the whole environment. There is no API
> surface to scope `publish all` to a single Sitecore site. Use
> Scenario 2 for site-scoped publishes.

## Scenario 4: unpublish a page (reversible)

You need to take a page off Edge without deleting it from CM.

```sh
scai content publish unpublish \
  --paths /sitecore/content/MyTenant/marketing/SunsetPromo \
  -n sandbox

scai content publish unpublish \
  --paths /sitecore/content/MyTenant/marketing/SunsetPromo \
  -n sandbox --allow-write --confirm-token <token>
```

The default `--strategy never-publish` writes `__Never publish: true`
on the version, then submits a follow-up publish job so Edge picks up
the removal.

> **Reversal is not yet a single CLI verb.** The `scai content version`
> command group (`inspect` / `set-validity` / `set-never-publish`) that
> would flip `__Never publish` back is written but **not registered** —
> it stays hidden until content items can be authored through the CLI
> (see the note in the README Publishing section). To reverse today,
> clear `__Never publish` on the version through another surface (the CM
> UI, a recipe, or the `version-fields` SDK helper) and then re-publish:
>
> ```sh
> scai content publish item --items <guid> -n sandbox --allow-write
> ```

Other strategies (use sparingly):

- `--strategy expire-now` — sets `__Valid to: <now>`. Reversible by
  clearing the field. Same Edge-removal mechanics as `never-publish`.
- `--strategy delete` — calls `deleteItem` permanently. **Not
  reversible.** Requires typed-item-path confirmation per item; with
  `--yes` for CI, also requires `--confirm-item-path <path>` matching
  scai's path resolution.

## Scenario 5: clean up the queue

A misconfigured job is stuck queued, or you submitted the wrong
republish and want to abort everything in flight.

```sh
# Single job by id
scai content publish cancel <jobId> -n sandbox

# Sweep the whole env — gated by typed env-name confirmation
scai content publish cancel --all-queued -n sandbox
```

Cancellation is asynchronous server-side; the immediate state is
typically `cancelling`, settling to `cancelled` within a few seconds.
Already-terminal jobs (Completed / Failed) are skipped silently.

## Scenario 6: read the audit trail

Every real publish-API write records a JSONL entry at
`~/.sitecoreai/audit.log` (env-overridable via `SITECOREAI_AUDIT_LOG`).
The `scai content publish history` verb filters and pretty-prints:

```sh
scai content publish history                              # last 50
scai content publish history --env sandbox --since 24h
scai content publish history --command 'unpublish'
scai content publish history --outcome error --json | jq -r '.errorMessage'
```

The audit entries include resolved tenant ID, scope hash, the scope
token used at submission (for replay correlation with the dry-run that
minted it), and `fieldChanges` arrays for content-state mutations —
everything you need to manually reverse a mistaken toggle.

## CI-friendly flow

```sh
# 1. Dry-run, parse the scope token from JSON output
TOKEN=$(scai content publish all --mode Smart -n sandbox --json \
  | jq -r '.scopeToken // empty')

# 2. Real submit + watch in one command (--non-interactive waits by default)
scai content publish all --mode Smart -n sandbox --allow-write \
  --confirm-token "$TOKEN" --yes --non-interactive
# Exits 0 on completed, 6 on failed, 130 on cancelled, 4 on watch timeout.
```

Pass `--no-wait` to override the auto-watch and exit immediately after
submission — useful when CI orchestrates the polling itself.

## Common errors

| Symptom                                                  | Cause                                                                                                                                        | Fix                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Token minted for env 'x' but missing publishing scopes` | Org-level credential used instead of env-level                                                                                               | Create an Automation Client at Environments → [env], not at the Org.      |
| `400 "Publishing locales should be specified"`           | Should not happen — scai auto-resolves tenant languages now. If you see this, scai's auto-resolve returned `[]` (tenant has zero languages). | Add a language to the tenant, or pass `--languages <list>` explicitly.    |
| `Scope token rejected (expired)`                         | More than 5 minutes between dry-run and real call                                                                                            | Re-run the dry-run to mint a fresh token.                                 |
| `Scope token rejected (scope-mismatch)`                  | Items/languages/mode changed between dry-run and real call                                                                                   | The token is bound to scope. Re-run the dry-run to capture the new scope. |
| `Job <id> is not cancellable (state 'completed')`        | Job already finished                                                                                                                         | Nothing to do — check `scai content publish status <id>` for the outcome. |
