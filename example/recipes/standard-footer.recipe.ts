import type { PartialDesignRecipe } from "../../src/recipe/schema/recipe";

/**
 * Phase 4 worked example — the standard footer partial. Used by every
 * page design (default, landing, article) so it exercises the
 * "common partial" pattern.
 *
 * Three component placements in `/footer`, each with its own shared
 * content datasource:
 *
 *   footer-link-grid@1     datasource: shared content `footer-grid-content@1`
 *   footer-social@1        datasource: shared content `footer-social-content@1`
 *   footer-copyright@1     datasource: shared content `footer-copyright-content@1`
 *
 * The `footer-social@1` placement also pins a variant — exercising the
 * `variant` field on `ComponentPlacement`.
 */
export const standardFooterRecipe = {
  kind: "partial-design",
  schemaVersion: "1",
  handle: "standard-footer@1",
  name: "StandardFooter",
  displayName: "Standard Footer",
  description: "Link grid, social block, and copyright in one reusable partial.",

  layout: {
    placeholders: {
      "/footer": [
        {
          componentHandle: "footer-link-grid@1",
          datasourceRef: { kind: "shared", handle: "footer-grid-content@1" },
        },
        {
          componentHandle: "footer-social@1",
          variant: "icons-only",
          datasourceRef: { kind: "shared", handle: "footer-social-content@1" },
        },
        {
          componentHandle: "footer-copyright@1",
          datasourceRef: { kind: "shared", handle: "footer-copyright-content@1" },
        },
      ],
    },
  },
} satisfies PartialDesignRecipe;
