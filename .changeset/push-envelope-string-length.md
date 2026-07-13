---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `recipe push --json` crashing with `RangeError: Invalid string length` after a fully successful apply. The JSON envelope's `events` array serialized every action's raw mutation snapshot — full field values per locale and, for media uploads, the asset bytes themselves — which overflowed V8's maximum string length on large multi-locale pushes. `mutation` is now a presence flag, diff values are capped at 2 KB each, and if envelope serialization still overflows the push re-emits the envelope with `events: []` and `eventsOmitted: true` instead of exiting non-zero.
