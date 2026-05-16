---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`audit find-replace`, `cleanup find-replace`, `audit stale-content` —
content-shaped hygiene additions.** Find/match/replace across field
values and an abandoned-content (graveyard) detector.

**New `scai audit *` verbs (read-only):**

- `audit find-replace list --pattern <regex>` — search field values for
  a regex or literal (`--literal`) pattern. Reports per-item per-field
  match counts plus sample snippets (~80 chars of context).
  - `--ignore-case` adds the `i` flag.
  - `--fields a,b,c` filters which fields are searched (default: all
    author-facing fields). `--include-system-fields` opts into the
    `__`-prefixed ones.
  - `--max-matches-per-item N` caps sample collection (default 10).
- `audit stale-content list --not-updated-in-days N` — items not
  updated in N days (default 365). Distinct from `audit
stale-workflow`:
  - `stale-workflow` finds items stuck mid-flight in a non-final
    workflow state.
  - `stale-content` finds **abandoned** content — published items no
    one has touched in a long time.
  - By default excludes items currently in a workflow (set
    `--no-exclude-workflow-items` to include).

**New `scai cleanup *` verb (mutating, with `--what-if` / `--allow-write`):**

- `cleanup find-replace apply --pattern <regex> --replacement <text>` —
  apply find-replace across content fields. Mirrors the audit's
  flag surface plus mutation safeguards:
  - `--max-mutations N` caps the change blast-radius (default 100).
  - `--include-system-fields` is gated behind the same flag; replacing
    `__Renderings` via regex would mangle the XML, so it's off by
    default.
  - `--what-if` reports the planned changes without mutating.
  - JS regex backreferences in `--replacement` are supported (`$1`,
    `$&`, `$<name>`). Literal `$` is `$$`.

**Hygiene client extension:** `updateItemFields({ itemId, fields })` —
new method for the cleanup find-replace path. Wraps the `updateItem`
mutation on the Authoring API; throws when the response doesn't echo
back an `itemId`.

**Workflow recommendation:** always run `audit find-replace list` to
verify match scope first, then `cleanup find-replace apply --what-if`
to preview, then drop `--what-if` to apply. The `--max-mutations` cap
protects against unintended scope creep when the regex is too loose.

15 new unit tests (141 total in hygiene module). Live-validated all
three new verbs against the sandbox tenant.
