---
"@sitecoreai-labs/sitecoreai-cli": patch
---

**Hygiene help cleanup + `dead-templates` auto-retry; `provision` IAR note.**

- `hygiene cleanup --help` and `hygiene audit --help` dropped the
  "Database scope" notes (they restated XM Cloud basics without
  helping). `cleanup --help` cut its example block from 18 lines to 5;
  `audit --help` now groups its ~30 subcommands by theme (Links &
  references, Media & assets, Templates & layout, …) instead of one
  flat wall.
- `hygiene cleanup dead-templates purge` now **auto-retries** the
  Authoring API's post-cascade-delete template-cache lag. The pre-flight
  already filters real structural dependents, so a "has dependents"
  error after that is the stale cache — the purge retries past the
  ~30-90s settle window instead of making the operator re-run by hand.
- `provision --help` notes that `scai provision iar` (package content
  as Items-as-Resources) is planned but not yet shipped.
