---
name: serialization-ops
description: Run serialization pull/push/diff/validate/watch workflows. Use when working with serialization commands, includes/excludes, or what-if runs.
---

# Serialization Ops

## Core commands

- Pull: `npm run dev -- serialization pull --environment-name <name>`
- Push: `npm run dev -- serialization push --environment-name <name> --allow-write`
- Diff: `npm run dev -- serialization diff -s <src> -d <dest>`
- Validate: `npm run dev -- serialization validate`
- Watch: `npm run dev -- serialization watch --environment-name <name>`

## Options to prefer

- `--include` / `--exclude` for scoped modules
- `--what-if` to preview actions
- `--json` for machine output

## Checklist

- Ensure config is valid and environment exists.
- Use `--allow-write` for push when config disallows writes.
