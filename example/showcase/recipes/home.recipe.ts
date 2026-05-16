import type { PageRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Showcase set — the home page. A `PageRecipe` is a concrete,
 * navigable item in the site content tree: it conforms to the
 * `showcase-page@1` page template, carries a field value, and declares
 * a page-local layout written to `__Final Renderings`.
 *
 * The `headless-main` placement is validated against
 * `showcase-main@1`'s Allowed Controls whitelist — `showcase-rich-text@1`
 * is allowed there. Its `scoped` datasource makes the compiler
 * materialise a page-local content item at `Home/ShowcaseHome/Data/HomeBody`
 * conforming to the rich-text component's datasource template.
 */
export const showcaseHomeRecipe = {
  kind: "page",
  schemaVersion: "1",
  handle: "showcase-home@1",
  name: "ShowcaseHome",
  displayName: "Showcase Home",
  description: "The showcase site's home page.",
  template: "showcase-page@1",
  fields: {
    MetaTitle: { shape: "text", value: "Welcome to the Showcase" },
  },
  layout: {
    placeholders: {
      "headless-main": [
        {
          componentHandle: "showcase-rich-text@1",
          datasourceRef: { kind: "scoped", slot: "HomeBody" },
        },
      ],
    },
  },
} satisfies PageRecipe;
