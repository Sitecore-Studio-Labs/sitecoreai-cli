---
"sitecoreai-cli": patch
---

Recipe multilist writes now normalize GUIDs to the dashed `{8-4-4-4-12}` form. The Authoring API's `createItem` returns dashless itemIds, and Sitecore silently ignores dashless GUIDs in TreelistEx/multilist fields — so page-template insert options appended to a parent's `__Masters` never resolved in Pages' "Create page (+)". `formatMultiList`, `parseMultiList`, `AppendToMultiList` desired values, and path-resolved base templates all dashify now, and merge-unique recognises previously written dashless entries as equal to their dashed form (no duplicate entries on re-push).
