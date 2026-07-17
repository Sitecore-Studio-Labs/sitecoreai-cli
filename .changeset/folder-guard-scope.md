---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe push: the marker-first name-collision guard no longer fires on field-less organizational folders. Shared grouping folders (`Presentation/Enumerations/Layout`, shared data folders, …) are legitimately claimed by many recipes but wear only the first creator's `Scai Handle` marker — since 0.34.5 every re-push against an environment with history failed at plan time with "Name collision: item 'Layout' … is owned by recipe 'alignment@1'". The guard is now scoped to field-bearing creates (inline authored fields or same-push SetField targets) — the only ops that can actually suffer the wrong-template field-write failure it protects against. Folder-class and marker-only creates keep the v0.33.0 lossless adopt-as-is behavior.
