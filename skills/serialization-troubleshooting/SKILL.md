---
name: serialization-troubleshooting
description: Diagnoses serialization errors and validation failures (duplicate IDs, scope/rule errors, alias conflicts, path collisions). Use when serialization validate/pull/push/watch fails or logs errors.
---

# Serialization Troubleshooting

## Triage steps

1. Reproduce with `npm run dev -- serialization validate` (add `--json` if needed).
2. If related to a specific module, use `--include <name>` or `--exclude <name>`.
3. Use `npm run dev -- serialization diff` to compare source/destination before a push.

## Common errors and fixes

### Duplicate serialized item id

- Find duplicates: `rg "ID:" serialization/`
- Fix by removing the duplicate file or correcting the item ID.

### Path included multiple times

- Overlapping module includes. Narrow include paths or add rule exclusions.

### Rule scope errors

- Wildcard rules only allow `itemAndDescendants` or `ignored`.
- `alias` cannot be combined with `scope` or wildcards.

### MaxRelativePathLength too small

- Set `maxRelativePathLength` to >= 16.

### Non‑TTY prompts

- Use `--use-client-credentials` or set `SITECOREAI_NON_INTERACTIVE=1`.
- Provide required flags instead of interactive prompts.

## Validation workflow

- Fix one module at a time.
- Re-run `serialization validate`.
- Only proceed to `push` after validation is clean.
