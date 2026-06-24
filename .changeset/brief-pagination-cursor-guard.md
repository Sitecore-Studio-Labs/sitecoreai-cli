---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(brief): stop campaign-linked brief pushes hanging on a non-advancing Orchestrate pagination cursor

`briefInstanceKind`'s `findProjectIdByLabels` (and the sibling `findBriefByName` / `list` walks) paged the list endpoints with an unbounded `for(;;)` loop whose only exit was `next` going falsy. If the Orchestrate `listProjects` endpoint returns a `next` cursor that doesn't advance (a malformed/perpetual cursor), the loop pages forever — each request individually succeeds and only carries a per-request timeout, so the _loop_ never terminates and the whole brief push hangs until the caller's spawn timeout kills it. This hit **campaign-linked briefs only** (a `campaignHandle` brief resolves its project by paging all projects); standalone briefs never enter the loop, which is why a single brief in a story (e.g. a Paid Media brief) could hang while the others synced.

Adds a `drainPages` helper with a non-advancing-cursor guard (stop if the endpoint returns a `next` we already sent) plus a hard page cap, and routes the three brief-instance pagination walks through it. A stuck cursor now degrades to a clean "not found" — already handled non-fatally (the link is skipped, the brief is still written) — and logs a warning so the condition is observable instead of silently hanging.
