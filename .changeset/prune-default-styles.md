---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`scai provision recipe prune-defaults`: also prune the SXA Headless OOTB
`Presentation/Styles` buckets

Adds a fourth prune group covering the 11 default style buckets SXA
seeds under `<site>/Presentation/Styles` (Spacing, Add Highlight,
Content Alignment, Background Color, Background Layout, Navigation,
Link List, Rich Text, Promo, Image, Common Container). Parent
`Styles` folder is preserved; only the named children are removed.
Behaviour mirrors the existing three groups — idempotent, tolerant
of the concurrent-delete race, names case-and-space exact (mismatches
report `missing` rather than deleting the wrong thing).

New env-profile field `presentationStylesRoot` (also exposed under
`recipeRoots.presentationStyles`), env override
`SITECOREAI_ENV_<NAME>_PRESENTATION_STYLES_ROOT`, and CLI flag
`--presentation-styles-root`. The runner now requires all four roots —
configurations that previously ran prune-defaults with only the three
legacy roots will get `INPUT_INVALID` naming `presentationStylesRoot`
until the new field is set.
