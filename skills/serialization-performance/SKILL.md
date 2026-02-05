---
name: serialization-performance
description: Optimizes serialization performance using include/exclude, field filters, and watch options. Use when serialization is slow, large modules are involved, or the user asks about performance tuning.
---

# Serialization Performance

## Quick wins

- Scope to modules: `--include <name>` / `--exclude <name>`
- Use `--what-if` to avoid writes while reviewing changes
- Prefer targeted paths with `diff` when inspecting a small subtree

## Module layout tips

- Split large areas into multiple modules by product or domain.
- Use `excludedFields` to reduce noisy or heavy fields.
- Avoid overlapping include paths.

## Watch efficiency

- Use `serialization watch --skip-pull` when the initial pull is already done.
- Keep module paths shallow to reduce path hashing and file I/O.

## Output efficiency

- Use `--json` for machine output, or `--quiet` for minimal logs.
