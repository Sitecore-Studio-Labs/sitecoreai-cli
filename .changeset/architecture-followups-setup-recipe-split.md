---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Internal architecture refactor (no behavior or public API changes): extracted the
environment-setup lifecycle out of `serialization/` into a dedicated top-level
`setup/` area, and split four oversized `recipe/` modules
(`runtime/execute.ts`, `runtime/plan.ts`, `tasks/pull.ts`, `compile/shared.ts`)
into cohesive submodules along strict acyclic boundaries. The public SDK export
surface is unchanged.
