---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Security: resolve Dependabot advisories by updating dependencies. Bumps `hono` to `^4.12.25` and `esbuild` to `^0.28.1` (runtime), and `vite` to `^7.3.5` and `js-yaml` to `^4.2.0` (dev) via overrides. The production dependency audit is now clean. One js-yaml ≤4.1.1 DoS advisory remains only in the dev-only `@changesets` → `@manypkg` → `read-yaml-file@1.1.0` chain, which pins js-yaml v3 (uses the removed-in-v4 `safeLoad`) and parses only trusted release files; it does not ship to consumers.
