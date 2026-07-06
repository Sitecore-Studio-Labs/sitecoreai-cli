---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Replace polynomial trailing-slash regexes in the media-path builders with
the loop-based `trimEndChar` helper. The `/\/+$/` `.replace(...)` calls on
`mediaLibraryRoot` / `folder` / `locationFolder` were flagged by CodeQL as a
polynomial-time ReDoS pattern; `trimEndChar` trims trailing `/` in linear
time with no backtracking. No behavioural change.
