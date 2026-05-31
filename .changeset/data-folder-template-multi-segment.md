---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: sanitise multi-segment subfolder when naming a per-location data-folder template

A `datasource.locations: [{ scope: "site", subfolder: "Site Shared UI/Avatars", allowedTemplates: [...] }]` block compiled into a per-location data-folder template whose item NAME embedded the raw subfolder string — producing `"avatar-block Site Shared UI/Avatars Data Folder"`. Sitecore's `InvalidItemNameChars` setting rejects `/` in item names, so Authoring GraphQL aborted the upsert with:

```
An item name cannot contain any of the following characters: \/:?"<>|[]
```

`emitSiteDataFolderTemplate`'s per-location path now collapses `/` to `-` in the item NAME (and the path segment) so both subfolder segments stay legible without violating the name rule. The display NAME keeps the original `/` since Sitecore allows it there.

```ts
// subfolder: "Site Shared UI/Avatars"

// item name (sanitised):
"avatar-block Site Shared UI - Avatars Data Folder";

// display name (preserved):
"Avatar Block Site Shared UI/Avatars Data Folder";
```

The SHARED data-folder template path (cross-recipe coalescing) was already correct — it used `leafSegment` and routed intermediate segments into the path hierarchy. Only the per-location codepath had the bug.

Repro: any `ComponentTemplateRecipe` with `datasource.locations` declaring a multi-segment subfolder + `allowedTemplates` aborted on push.
