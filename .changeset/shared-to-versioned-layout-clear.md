---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Page compile: guarded shared `__Renderings` clear for the shared → versioned layout transition. A page previously pushed with `layoutScope: "shared"` and re-pushed with the default versioned scope now gets its recipe-owned shared layout cleared (ownership-guarded via `clearWhenEquivalentTo`, mirroring the existing versioned → shared clears), so the layout lives only in the Pages-editable per-language `__Final Renderings` instead of silently duplicating in the shared layer underneath.
