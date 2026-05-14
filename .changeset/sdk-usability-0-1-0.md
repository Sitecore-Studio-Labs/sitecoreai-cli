---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**SDK usability pass — package root, subpath coverage, client seams, stability contract.**

Five changes that take scai from "internally-usable library buried under
a CLI binary" to "explicit SDK with a public contract."

### 1. Package root no longer executes the CLI

`package.json` `main` was `dist/cli.js`, which has a `#!/usr/bin/env node`
shebang and runs commander on require. Any consumer doing
`import "@sitecoreai-labs/sitecoreai-cli"` (no subpath) would execute the
CLI.

`main` now points at a new `dist/index.js` SDK barrel that namespace-
re-exports every public subpath:

```ts
import { recipe, deploy, publishing, ScaiError } from "@sitecoreai-labs/sitecoreai-cli";
```

The CLI binary is still on `bin` and unchanged.

### 2. Four new subpath exports

The following surfaces are now in `package.json#exports` with their own
public `index.ts` (curated, with a stability-contract docstring):

- `./sites` — XM Cloud Sites API client (sites, collections, languages,
  jobs, templates)
- `./publishing` — XM Cloud Publishing API client + `PublishConsent`
  scope-token primitives + audit-log primitives + `isProductionTier`
- `./hygiene` — audit/cleanup task runners, `HygieneApiClient` factory,
  output adapters (JSON / CSV / Markdown), baseline + history snapshots,
  field cache
- `./webhooks` and `./workflow` — already had internal `index.ts`; now
  wired through the package's `exports` map

### 3. Client seams on `./deploy` and `./serialization`

`./recipe` already shipped `createAuthoringClient` and `createSitesApiClient`
factories. The other two surfaces only had bag-of-functions; the
factories below close the shape gap:

- `createDeployApiClient(options: DeployApiClientOptions): DeployApiClient` —
  curated 80%-use-case subset (~25 methods: orgs / projects /
  environments / deployments / logs / source control). The long-tail
  60+ functions remain exported for direct use.
- `createSitecoreApiClient(options: SitecoreApiClientOptions): SitecoreApiClient` —
  full options-bound facade over items / history / roles / users /
  publish (12 methods).

These are options-binding adapters, not behavioral wrappers — the
behavioral seam (path resolution, parent-folder auto-create, retries)
remains in `createAuthoringClient`.

### 4. "Using as a library" README section

New section between MCP and "Going deeper" with one minimal example per
subpath, namespace-import alternative, and the explicit 0.1.0 stability
contract: symbols re-exported from each subpath's `index.ts` are the
public contract; anything reachable only via `@/...` aliases is internal
and may change without notice.

### 5. Stability contract at 0.1.0

This release graduates the SDK surface. Breaking changes to exported
symbols now require a major version bump (per Changesets). New symbols
remain additive and ship in minor versions.
