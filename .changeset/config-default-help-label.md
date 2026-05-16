---
"@sitecoreai-labs/sitecoreai-cli": patch
---

**`--config` help no longer prints an absolute path.** The shared
`--config` option defaulted to `process.cwd()`, and Commander bakes the
_resolved_ value into `--help` — so every command showed
`(default: "/Users/.../wherever-it-ran")`, machine-specific noise.
It now shows `(default: current directory)`. The runtime value is
unchanged. Applies to all commands that take `--config`, plus
`scai mcp serve`.
