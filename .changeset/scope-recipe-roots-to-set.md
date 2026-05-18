---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Scope the `templatesRoot` / `renderingsRoot` requirement to recipe sets that actually create template or rendering items.

`recipe compile` and `recipe push` previously required both roots to be configured (in the env profile or via `--templates-root` / `--renderings-root`) before they would run — even for a `workflow` or `webhook-authorization` recipe, whose compilers create items under hardcoded `/sitecore/system` roots and never read either value. A workflow recipe now compiles, plans, and pushes with neither root configured. An IR-only `recipe push` (no recipe-source files) skips the requirement for the same reason.
