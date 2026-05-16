import type { PlaceholderRecipe } from "../../src/recipe/schema/recipe";

/**
 * Worked example — the main page-body placeholder.
 *
 * A standalone `PlaceholderRecipe` is the hybrid placeholder model's
 * site-chrome half: a slot that belongs to no single component. It
 * compiles to one Sitecore Placeholder Settings item carrying a
 * `Placeholder Key` and an `Allowed Controls` whitelist.
 *
 * `allowedComponents` is the slot-side half of "what's allowed here";
 * it's unioned with any component that names this `key` in its
 * `placedIn`. A page design or page template placing a component into
 * `headless-main` is then validated against that whitelist —
 * `validateRecipeSet` raises a `PlacementViolation` for anything not
 * listed.
 *
 * (Container components that own their slots declare them inline via
 * `ComponentTemplateRecipe.placeholders` instead — same compiled
 * artifact, component-owned rather than site-owned.)
 *
 * `folder` nests the Placeholder Settings item under
 * `<placeholderSettingsRoot>/Page Designs/Main`; the grouping folder is
 * emitted as a `CreateOnly` item conforming to the SXA `Placeholder
 * Settings Folder` template, so it inherits that template's Insert
 * Options.
 */
export const pageBodyPlaceholderRecipe = {
  kind: "placeholder",
  schemaVersion: "1",
  handle: "page-body-slot@1",
  key: "headless-main",
  name: "Main",
  displayName: "Page Body",
  description: "The primary content placeholder every page design exposes for page-local content.",
  folder: "Page Designs",

  allowedComponents: ["rich-text-block@1", "card-block@1", "cta-button@1", "accordion-block@1"],
} satisfies PlaceholderRecipe;
