---
name: serialization-config-authoring
description: Authors and validates serialization module configuration, includes/rules/aliases, and serialization options. Use when editing sitecoreai.cli.json or module.module.json files, or when the user asks about scopes, includes/excludes, aliases, or maxRelativePathLength.
---

# Serialization Config Authoring

## Quick start

- Validate: `npm run dev -- config validate`
- Validate serialization content: `npm run dev -- serialization validate`

## Authoring checklist

1. **Root config**: `sitecoreai.cli.json` has `modules` and `defaultEnvProfile`.
2. **Module files**: each `module.module.json` has `namespace` and `items.includes`.
3. **Items path**:
   - `items.path` can use `~/` to be rooted at the repo and `$(module)` to use the namespace.
4. **Includes**: every include has `name`, `path`, optional `scope`, `allowedPushOperations`.
5. **Rules**:
   - `scope` is required unless using `alias`.
   - `alias` cannot be combined with `scope` or wildcards.
   - `alias` chars: letters, numbers, spaces, hyphen, underscore.
6. **Path length**: `maxRelativePathLength` should be >= 16 for hashing to work.
7. **Excluded fields**: use `excludedFields` with `fieldId` (optional `description`).

## Examples

### Minimal module

```json
{
  "namespace": "content",
  "items": {
    "path": "~/serialization/$(module)",
    "includes": [
      {
        "name": "content",
        "path": "/sitecore/content",
        "scope": "itemAndDescendants"
      }
    ]
  }
}
```

### Include with rules and alias

```json
{
  "name": "marketing",
  "path": "/sitecore/content/Marketing",
  "rules": [
    { "path": "/sitecore/content/Marketing/Archive", "scope": "ignored" },
    { "path": "/sitecore/content/Marketing/Short", "alias": "short" }
  ]
}
```

## When modifying configs

- Run `npm run dev -- serialization validate` after edits.
- Use `--include` / `--exclude` for scoped validation runs.
