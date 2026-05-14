---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Three new `scai audit` verbs — security / permission hygiene.**
Built on the Authoring API's user/role/profile surface.

- `audit empty-roles list` — roles with zero direct members. Uses
  `members(first: 1)` as the count signal since AccountConnection
  doesn't expose `totalCount`.
- `audit role-bloat list --threshold <count>` — users with more than
  N role memberships (default 10). Counts direct memberships only;
  excludes administrators by default. Soft signal for "this user
  accumulated emergency access that nobody cleaned up."
- `audit stale-users list --not-active-days <count>` — users who
  haven't logged in (or had any activity, with `--use-activity-date`)
  in N days. Default 180 days, `lastLoginDate` signal. Excludes admins
  - likely service accounts (regex on user name) by default; pass
    `--include-admins` / `--include-service-accounts` to override.

**Hygiene client extensions:** `listUsers`, `listRoles`, `getUserDetail`
on the Authoring API. Per-call paging via `AccountConnection.pageInfo`.

**Explicit scope:** `audit anonymous-write` and `audit excessive-acls`
were considered but dropped. The Authoring API's `Item.access` only
exposes booleans from the **caller's** perspective (the OAuth
client-credentials identity); there's no per-role ACL detail exposed
on items. Building those audits would require impersonation or a
SQL-shaped surface that XM Cloud doesn't have.

11 new unit tests (171 total in hygiene module). Live-validated all
three against the sandbox tenant (188-day-stale `JssImport` service
account surfaced as expected).
