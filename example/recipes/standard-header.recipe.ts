import type { PartialDesignRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — a reusable header partial. Linked into
 * page designs that want the standard site chrome.
 *
 * Three component placements in `/header`:
 *
 *   site-logo@1          datasource: shared content `site-logo-content@1`
 *   primary-nav@1        datasource: shared content `primary-nav-content@1`
 *   utility-nav@1        datasource: shared content `utility-nav-content@1`
 *
 * The shared-handle datasource refs make this partial concrete — drop it
 * into any tenant and the same logo, primary nav, and utility nav appear,
 * sourced from registry-shipped content items rather than tenant-authored
 * page-local content.
 */
export const standardHeaderRecipe = {
  kind: "partial-design",
  schemaVersion: "1",
  handle: "standard-header@1",
  name: "StandardHeader",
  displayName: "Standard Header",
  description: "Site logo, primary navigation, and utility navigation in one reusable partial.",

  layout: {
    placeholders: {
      "/header": [
        {
          componentHandle: "site-logo@1",
          datasourceRef: { kind: "shared", handle: "site-logo-content@1" },
        },
        {
          componentHandle: "primary-nav@1",
          datasourceRef: { kind: "shared", handle: "primary-nav-content@1" },
        },
        {
          componentHandle: "utility-nav@1",
          datasourceRef: { kind: "shared", handle: "utility-nav-content@1" },
        },
      ],
    },
  },
} satisfies PartialDesignRecipe;
