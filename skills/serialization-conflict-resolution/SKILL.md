---
name: serialization-conflict-resolution
description: Resolves serialization conflicts and move/rename/update issues safely. Use when pull/push conflicts, diff disagreements, or standard values ordering issues appear.
---

# Serialization Conflict Resolution

## Safe workflow

1. Run `serialization diff` to understand divergence.
2. Use `serialization pull --what-if` to preview inbound changes.
3. Resolve conflicts locally, then run `serialization validate`.
4. Push with `--what-if` before `--allow-write`.

## Common conflict patterns

- **Move vs rename**: ensure item path and parent IDs reflect the intended change.
- **Standard values**: `__Standard Values` are ordered after other creates; verify they exist and are correct.
- **Overlapping includes**: remove overlap or add explicit rule exclusions.

## Resolution techniques

- Adjust module `rules` to include/exclude specific subtrees.
- Use `allowedPushOperations` to block deletes when unsure.
- If unsure, split the module and re-run diff for each part.
