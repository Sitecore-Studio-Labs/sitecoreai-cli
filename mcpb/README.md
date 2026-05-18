# scai MCP Bundle (`.mcpb`)

A one-click [MCP Bundle](https://github.com/anthropics/mcpb) for installing
the scai MCP server into Claude Desktop (and other apps that support `.mcpb`).

## What this is

A **thin bundle** — it ships only [`manifest.json`](./manifest.json) and a
smart launcher ([`server/index.js`](./server/index.js)). It does **not**
bundle scai itself, because scai depends on a native keychain module that
would make a bundled build OS-specific.

The launcher re-execs your own installed scai build as `scai mcp serve`,
wiring stdin/stdout/stderr straight through.

## Cold-start auth

scai needs a `sitecoreai.cli.json` to bind an environment. An MCP server is
spawned non-interactively, so a browser login cannot happen at startup. The
launcher resolves a config in this order:

1. **Config file** — if you set the `config_path` field to your own
   `sitecoreai.cli.json` (e.g. from a project where you ran `scai setup`),
   it is used read-only. The bundle never writes to it.
2. **Previous bundle config** — a config the bundle wrote on an earlier
   launch (`~/.sitecoreai/mcpb/sitecoreai.cli.json`) is reused.
3. **Org credential** — if you fill the organization ID and automation
   client ID + secret, the launcher runs `scai setup init` once: scai mints
   a token from the credential, discovers the CM host, project, environment,
   and tenant via the Deploy API, and writes the bundle-managed config. The
   first launch is slower while this runs; later launches reuse the config.
   The secret is passed as an env var and never written to disk.
4. **None** — the launcher prints copy-paste setup instructions to stderr
   (visible in Claude Desktop's extension logs) and exits.

If your organization has more than one Sitecore Cloud project or
environment, `scai setup init` cannot guess which one — it will report what
to specify. Fill the **Deploy project** / **Deploy environment** fields and
re-enable the extension. To re-bootstrap after changing credentials, delete
`~/.sitecoreai/mcpb/sitecoreai.cli.json`.

For a browser-based (OIDC) login instead, run `scai setup init --wizard` and
`scai setup login` in a terminal once, then point `config_path` at the file.

## Build the `.mcpb`

```bash
npm run build        # produces dist/cli.js, which the bundle launches
npm run mcpb:pack    # validates the manifest and writes scai.mcpb at the repo root
```

`scai.mcpb` is gitignored. Drag it onto Claude Desktop to install.

## Install (Claude Desktop)

1. Settings → Extensions → drag in `scai.mcpb` (or double-click it).
2. Fill the settings form:
   - **scai CLI entry point** (required) — `dist/cli.js` of a built scai
     checkout, or the `cli.js` of a global `npm i -g` install.
   - **Config file** — your own `sitecoreai.cli.json`, or blank to let the
     bundle manage one.
   - **Environment name** — profile to bind, or the name for the
     bundle-managed profile (blank = `default`).
   - **Organization ID / Automation client ID + secret** — fill these to
     let the bundle run `scai setup init` and build its own config with no
     terminal step.
   - **Deploy project / Deploy environment** — only if `scai setup init`
     reports your organization has more than one to choose from.
3. Enable the extension.

## Troubleshooting

If the extension fails to start, the launcher writes every launch — and the
full output of `scai setup init` — to:

```
~/.sitecoreai/mcpb/launcher.log
```

The same messages are mirrored to Claude Desktop's extension log. A common
cause is an organization with more than one Sitecore Cloud project or
environment: `scai setup init` cannot guess which to use and the log will
say so — fill the **Deploy project** / **Deploy environment** fields.

## Notes

- `version` in `manifest.json` is not auto-synced with `package.json` — bump
  it when cutting a release.
- The `scai_cli_path` default is a machine-specific absolute path. Drop the
  `default` from `manifest.json` before distributing the bundle to others.
- The bundle-managed config (`~/.sitecoreai/mcpb/sitecoreai.cli.json`) is
  written once by `scai setup init` and reused. Delete it to re-bootstrap
  after changing the credential fields.
- For the manual (non-bundle) setup, see [`docs/mcp.md`](../docs/mcp.md).
