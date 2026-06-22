---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(unstable): bundle-safe subpath exports for the brand/brief/campaign/agents schemas

Adds dedicated package exports `./unstable/{brief,brand,campaigns,agents}/schema`
pointing at each family's compiler-free `schema-only` module. Previously these
zod-only schemas were only reachable through the `./unstable` namespace barrel,
which also pulls each family's sync / API / MCP graph (esbuild). The new subpaths
mirror `./recipe/schema`: an external consumer (the registry, including its
client components) can import e.g. `BriefTypeRecipeSchema` /
`BriefInstanceRecipeSchema` without dragging the compiler into client bundles.
