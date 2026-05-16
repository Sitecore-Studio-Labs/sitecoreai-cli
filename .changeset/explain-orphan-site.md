---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**New: `scai hygiene explain orphan-site <site>`.**

A second `explain` verb, composing two audits the way `explain
why-blocked` composes its pair:

- `audit site-residue` — orphan tenant/site trees left behind after a
  Sites-API site delete.
- `audit references` — inbound field references to each orphan tree.

`explain orphan-site <site>` filters the residue to one site and counts
inbound references per orphan tree, flagging the ones still referenced
by live content — so you know which orphans `cleanup site-residue
purge` can take now and which need their referrers resolved first.

`audit site-residue` gained a `silent` option (matching `audit
references` / `audit template-dependencies`) so the `explain` verb owns
the printed report.
