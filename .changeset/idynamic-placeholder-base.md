---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: fix `dynamicPlaceholders: true` to also inherit `_IDynamicPlaceholder`

`ComponentTemplateRecipe`'s `dynamicPlaceholders: true` flag previously
only wrote `IsRenderingsWithDynamicPlaceholders=true` into the rendering's
`OtherProperties` shared field. That's necessary-but-not-sufficient: SXA
Pages chrome also needs the parameters template to inherit
`_IDynamicPlaceholder`
(`/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder`),
which contributes the `DynamicPlaceholderID` field the chrome writes
per-placement integers to.

Without the base, the chrome had no field to write the placement ID, no
`DynamicPlaceholderId` param appeared in layout-service rendering data,
and nested children either failed to bind in Pages or persisted against
the wrong slot key — symptom was the headless SDK warning
`Placeholder '<slot>-1' was not found in the current rendering data` on
visibly-authored containers.

`emitParamsTemplate` now appends `_IDynamicPlaceholder` to the params
template's `__Base template` chain whenever the recipe sets
`dynamicPlaceholders: true`. The OtherProperties write is unchanged.

Combining `dynamicPlaceholders: true` with `parameters: { handle }`
(an external `ParametersTemplateRecipe` reference) now throws
`INPUT_INVALID`. The external template may be shared across components;
mutating its base-template chain from a single consumer would silently
affect every other reader. Move to inline `params:` or extend
`ParametersTemplateRecipe` with its own flag if/when needed.
