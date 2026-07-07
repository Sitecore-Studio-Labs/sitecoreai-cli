---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Localized pushes are dramatically faster, and installs can defer locales entirely:

- **`addItemVersion` joins the apply flush pool.** Version adds were a global pool barrier, and localized content interleaves them with field writes — so dictionary translations and `__Standard Values` locale maps applied strictly serially (one round-trip at a time; a 70-phrase × 9-locale dictionary alone was ~1,400 serial round-trips). The pool now serializes per **(item, language) version stack** — stacks for different languages overlap freely — and each op's plan awaits only the stacks it reads (`settle`) instead of draining the whole pool.
- **Phased locale emission.** The dictionary compiler and the Standard-Values locale-map emitter group all `AddItemVersion` ops ahead of all translation `SetField`s (creates → adds → writes), so the grouped adds actually fan out `applyConcurrency`-wide instead of gating on each other's field writes.
- **`recipe push --languages <csv>`** scopes a push's locale surface: only scoped locales are registered on the environment and emitted for localized content; a bare base language covers its regional variants (`fr` matches `fr-FR`). The primary locale always installs, so `--languages en` is the fast content-first install — re-push without the flag later to add the remaining locales (version adds and translations are idempotent).
