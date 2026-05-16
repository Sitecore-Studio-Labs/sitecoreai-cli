/**
 * Local verification for the showcase recipe set — validate + compile,
 * no tenant access. Run: `pnpm exec tsx -r tsconfig-paths/register
 * example/showcase/_verify.ts`.
 */
import { showcaseCtaRecipe } from "./recipes/cta.recipe";
import { showcaseDesignRecipe } from "./recipes/design.recipe";
import { showcaseHeaderRecipe } from "./recipes/header.recipe";
import { showcaseHeaderPlaceholderRecipe } from "./recipes/header-placeholder.recipe";
import { showcaseHomeRecipe } from "./recipes/home.recipe";
import { showcaseMainPlaceholderRecipe } from "./recipes/main-placeholder.recipe";
import { showcasePageRecipe } from "./recipes/page.recipe";
import { showcaseRichTextRecipe } from "./recipes/rich-text.recipe";
import { compileRecipeSet, type CompileContext } from "../../src/recipe/compile";
import type { Recipe } from "../../src/recipe/schema/recipe";
import { formatValidationErrors, isValid, validateRecipeSet } from "../../src/recipe/validate";

const recipes: Recipe[] = [
  showcaseCtaRecipe,
  showcaseRichTextRecipe,
  showcaseMainPlaceholderRecipe,
  showcaseHeaderPlaceholderRecipe,
  showcaseHeaderRecipe,
  showcasePageRecipe,
  showcaseDesignRecipe,
  showcaseHomeRecipe,
];

const context: CompileContext = {
  site: "demo-registry",
  templatesRoot: "/sitecore/templates/Project",
  renderingsRoot: "/sitecore/layout/Renderings/Project",
  partialDesignsRoot: "/sitecore/content/demo-registry/content-modelling/Presentation/Partial Designs",
  pageDesignsRoot: "/sitecore/content/demo-registry/content-modelling/Presentation/Page Designs",
  headlessVariantsRoot: "/sitecore/content/demo-registry/content-modelling/Presentation/Headless Variants",
  pageTemplatesRoot: "/sitecore/templates/Project/demo-registry",
  pagesRoot: "/sitecore/content/demo-registry/content-modelling/Home",
  placeholderSettingsRoot: "/sitecore/content/demo-registry/content-modelling/Presentation/Placeholder Settings",
};

const result = validateRecipeSet(recipes);
console.log("validateRecipeSet — valid:", isValid(result));
if (!isValid(result)) {
  console.log(formatValidationErrors(result));
  process.exit(1);
}

const irs = compileRecipeSet(recipes, context);
const totalOps = irs.reduce((n, ir) => n + ir.operations.length, 0);
console.log(`compileRecipeSet — ${irs.length} IRs, ${totalOps} ops`);
for (const ir of irs) {
  console.log(`  ${ir.recipeHandle.padEnd(28)} ${ir.operations.length} ops`);
}
