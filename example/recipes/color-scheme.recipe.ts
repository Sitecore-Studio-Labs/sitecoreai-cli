import type { EnumerationRecipe } from "../../src/recipe/schema/recipe";

/**
 * Reusable color-scheme enumeration. Backs Droplink fields on every
 * component recipe that wants to share the same "primary / secondary /
 * accent / neutral" picker — instead of repeating an inline `values:`
 * list on each one (which would create N independent Sitecore items
 * and force authors to keep them in sync by hand).
 *
 * Compiles to:
 *
 *   <enumerationsRoot>/ColorScheme            (container, ColorScheme template)
 *   <enumerationsRoot>/ColorScheme/Primary    (value item)
 *   <enumerationsRoot>/ColorScheme/Secondary
 *   <enumerationsRoot>/ColorScheme/Accent
 *   <enumerationsRoot>/ColorScheme/Neutral
 *
 * Reference from any other recipe field:
 *
 *   {
 *     name: "ColorScheme",
 *     shape: "enum",
 *     sitecore: { type: "droplink", enumHandle: "color-scheme@1" },
 *   }
 *
 * Re-push semantics: adding a new value (e.g. `"Inverse"`) surfaces
 * it on every referencing field automatically — the Droplink Source
 * resolves by container path, not by static value list, so consumers
 * don't need to be re-pushed when the enum grows.
 *
 * Naming: enum-as-data lives at site scope by default (the omitted
 * `location` block). To group multiple enums under a folder, set
 * `location: { scope: "site", folder: "Theme" }`.
 */
export const colorSchemeEnum = {
  kind: "enumeration",
  schemaVersion: "1",
  handle: "color-scheme@1",
  name: "ColorScheme",
  displayName: "Color scheme",
  description:
    "Reusable color-scheme picker. Referenced by components that expose a per-placement color choice (CTA buttons, badges, headers, …).",
  values: [
    { name: "Primary", displayName: "Primary" },
    { name: "Secondary", displayName: "Secondary" },
    { name: "Accent", displayName: "Accent" },
    { name: "Neutral", displayName: "Neutral" },
  ],
  defaultValue: "Primary",
} satisfies EnumerationRecipe;

export default colorSchemeEnum;
