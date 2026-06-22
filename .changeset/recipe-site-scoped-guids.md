---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(recipe): opt-in `siteScopedGuids` for per-site recipe item GUIDs

Recipe item GUIDs are derived as `uuidv5(`${seed}::${handle}`)`. The seed has
always been `"default"`, so a given recipe handle resolves to the **same**
Sitecore item regardless of site — correct for one-site-per-tenant, but a
GUID collision the moment the same handle is pushed to a second site in one
instance (Sitecore item IDs are globally unique).

Env profiles can now set `siteScopedGuids: true` to seed by the profile's
`site` instead, so the same handle yields a **distinct** item per site —
required to install one recipe onto multiple sites in a single Sitecore
instance. The seed is derived through a single `resolveSeedSite` helper that
every compile path (push, pull, compile, sync) and the skip-unchanged cache
key share, so the write path and the read/diff paths cannot disagree on item
GUIDs.

Leaving `siteScopedGuids` unset (or `false`) is **byte-identical** to prior
behavior — every existing `"default"`-seeded tenant is unaffected, including
profiles that already set `site` purely for recipeRoots derivation. Flipping
the flag on a tenant that has already pushed re-keys its items and must be
treated as a migration.
