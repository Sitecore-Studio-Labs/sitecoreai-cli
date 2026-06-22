import { describe, expect, it } from "vitest";
import { deriveRecipeRoots } from "../../../src/recipe/tasks/derive-roots";

const SITE = "demo-registry";
const COLLECTION = "showcase";

describe("deriveRecipeRoots — golden SXA Headless layout", () => {
  it("derives every root from (site, collection), matching the orchestrator formula", () => {
    // Golden: any drift in the SXA path formula fails loudly here. These
    // strings must stay byte-identical to the orchestrator's buildRecipeRoots
    // (packages/scai-shared/src/execution/ephemeral-cli-config.ts) or hosted
    // installs and standalone pushes diverge.
    expect(deriveRecipeRoots(SITE, COLLECTION)).toEqual({
      templates: "/sitecore/templates/Project/showcase/demo-registry/Components",
      components: "/sitecore/templates/Project/showcase/demo-registry/Components",
      contentModels: "/sitecore/templates/Project/showcase/demo-registry/Content Models",
      renderings: "/sitecore/layout/Renderings/Project/showcase/demo-registry/Components",
      partialDesigns: "/sitecore/content/showcase/demo-registry/Presentation/Partial Designs",
      pageDesigns: "/sitecore/content/showcase/demo-registry/Presentation/Page Designs",
      contentItems: "/sitecore/content/showcase/demo-registry/Data",
      headlessVariants: "/sitecore/content/showcase/demo-registry/Presentation/Headless Variants",
      availableRenderings:
        "/sitecore/content/showcase/demo-registry/Presentation/Available Renderings",
      presentationStyles: "/sitecore/content/showcase/demo-registry/Presentation/Styles",
      enumerations: "/sitecore/content/showcase/demo-registry/Presentation/Enumerations",
      placeholderSettings: [
        "/sitecore/content/showcase/demo-registry/Presentation/Placeholder Settings",
        "/sitecore/layout/Placeholder Settings/Project/showcase/demo-registry",
      ],
      placeholderSettingsCreate:
        "/sitecore/content/showcase/demo-registry/Presentation/Placeholder Settings",
    });
  });

  it("is deterministic for the same inputs", () => {
    expect(deriveRecipeRoots(SITE, COLLECTION)).toEqual(deriveRecipeRoots(SITE, COLLECTION));
  });

  it("scopes every derived root under <collection>/<site>", () => {
    const roots = deriveRecipeRoots(SITE, COLLECTION);
    const scoped = `${COLLECTION}/${SITE}`;
    for (const value of Object.values(roots).flat()) {
      expect(value).toContain(scoped);
    }
  });

  it("trims surrounding whitespace in site / collection", () => {
    expect(deriveRecipeRoots("  demo-registry  ", "  showcase  ")).toEqual(
      deriveRecipeRoots(SITE, COLLECTION)
    );
  });

  it("throws INPUT_INVALID when site or collection is blank", () => {
    expect(() => deriveRecipeRoots("", COLLECTION)).toThrowError(/site name and a site collection/);
    expect(() => deriveRecipeRoots(SITE, "   ")).toThrowError(/site name and a site collection/);
  });
});
