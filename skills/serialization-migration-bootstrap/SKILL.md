---
name: serialization-migration-bootstrap
description: Bootstraps new serialization modules and migrations from existing items. Use when creating new module.module.json files, initial pulls, or migrating serialization layouts.
---

# Serialization Migration / Bootstrap

## Bootstrap workflow

1. Create `sitecoreai.cli.json` (or update existing) and add module paths.
2. Create a new `module.module.json` with a single include.
3. Run `serialization pull --environment-name <name>` to populate items.
4. Run `serialization validate` to confirm consistency.

## Migration tips

- Start with small, well-scoped modules.
- Validate after each module before expanding scope.
- Use `--include` during early pulls to keep scope tight.

## Optional packaging

- Create packages with `serialization package create`.
- Install packages with `serialization package install --what-if` first.
