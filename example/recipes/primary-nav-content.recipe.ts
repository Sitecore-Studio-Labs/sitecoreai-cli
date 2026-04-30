import type { ContentItemRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — a shared content item with a multi-handle
 * reference field. Referenced from `standard-header@1`'s `primary-nav@1`
 * placement via `datasourceRef: { kind: "shared", handle: "primary-nav-content@1" }`.
 *
 * Demonstrates the `reference` value shape (always-array of handles) —
 * the navigation's links are themselves content items the registry
 * would ship as a peer set (`nav-link-products@1`, `nav-link-pricing@1`,
 * `nav-link-docs@1`). The Phase 4 compiler resolves each via
 * `contentItemId(handle)` and emits a pipe-separated GUID list.
 */
export const primaryNavContentRecipe = {
  kind: "content-item",
  schemaVersion: "1",
  handle: "primary-nav-content@1",
  name: "PrimaryNavContent",
  displayName: "Primary Navigation (default)",
  description: "Default primary navigation links used by the standard-header partial.",

  templateType: "primary-nav-template@1",

  fields: {
    Label: {
      shape: "text",
      value: "Primary",
    },
    Links: {
      shape: "reference",
      refs: ["nav-link-products@1", "nav-link-pricing@1", "nav-link-docs@1"],
    },
  },
} satisfies ContentItemRecipe;
