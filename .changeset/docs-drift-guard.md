---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Corrected stale path references across the docs and skills, and added a test that keeps them correct.

Ten references had drifted: `src/shared/telemetry.ts` (the module is `src/telemetry/index.ts`), `src/recipe/guids.ts` (`src/recipe/items/guids.ts`), `src/serialization/tasks/env/constants.ts` (moved to `src/setup/constants.ts` when `setup/` was extracted), `tests/unit/shared/redact.test.ts` (the coverage lives in `shared-utils.test.ts`), a `tests/unit/_fixtures/` convention that never existed, a probe script deleted by the security scrub, and two markdown links pointing into a sibling checkout that only resolved on one machine. Both CLAUDE.md and the `codebase-conventions` skill also claimed 21 domain areas while `src/` had 22, with `telemetry/` listed twice — once as an area and once as a cross-cutting layer.

`tests/unit/architecture/docs-drift.test.ts` now enforces this. It walks the whole doc corpus — `docs/`, `.claude/skills/`, the shipped `skills/` bundle, and the root markdown files, 52 files rather than the zero previously checked — and asserts that every backticked repo path and every relative markdown link resolves. It also checks structural claims against the code instead of against a string: the domain-area block against `src/`, both directions of both skills indexes, and the quality-gates table against `package.json` scripts. `docs/archive/` is excluded as a point-in-time record.

Every allowlist in the test has its own staleness guard, so an entry that stops being true fails rather than silently widening the exemption.

Only the `skills/` corrections ship in the tarball; the rest are repo-internal.
