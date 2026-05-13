import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRecipeCompile } from "../../../../src/recipe/tasks/compile";
import { ctaButtonRecipe } from "../../../../example/recipes/cta-button.recipe";

const CONTEXT = {
  templatesRoot: "/sitecore/templates/Project/sandbox/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/sandbox",
  headlessVariantsRoot: "/sitecore/content/test-tenant/sandbox/Presentation/Headless Variants",
  enumerationsRoot: "/sitecore/content/test-tenant/sandbox/Settings/Enumerations",
};

// Minimum valid sitecoreai.cli.json shape per src/config/schema.json: only
// `modules` is required (minItems: 1). runRecipeCompile reads the root config
// before touching the recipe, so without this fixture the test never reaches
// the recipe-validation code path it's asserting on.
const MINIMAL_CLI_CONFIG = JSON.stringify({ modules: ["./fixtures/**/*.module.json"] });

const setupTmpWorkspace = async (): Promise<string> => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-recipe-compile-"));
  await fs.writeFile(path.join(tmpDir, "sitecoreai.cli.json"), MINIMAL_CLI_CONFIG, "utf8");
  return tmpDir;
};

describe("runRecipeCompile", () => {
  it("reads a recipe.json and writes an Operation IR JSON file", async () => {
    const tmpDir = await setupTmpWorkspace();
    const recipePath = path.join(tmpDir, "cta-button.recipe.json");
    const irPath = path.join(tmpDir, "cta-button.ir.json");
    await fs.writeFile(recipePath, JSON.stringify(ctaButtonRecipe), "utf8");

    await runRecipeCompile({
      config: tmpDir,
      input: recipePath,
      output: irPath,
      templatesRoot: CONTEXT.templatesRoot,
      renderingsRoot: CONTEXT.renderingsRoot,
      headlessVariantsRoot: CONTEXT.headlessVariantsRoot,
      enumerationsRoot: CONTEXT.enumerationsRoot,
      json: true,
      quiet: true,
    });

    const written = JSON.parse(await fs.readFile(irPath, "utf8"));
    expect(written.schemaVersion).toBe("1");
    expect(written.recipeHandle).toBe("cta-button@1");
    // cta-button's Size + ColorScheme params override sitecore.type to
    // "droplist", so the inline-enum folder + value items + per-site
    // Enumeration template pair don't emit. 19 baseline ops total.
    expect(written.operations).toHaveLength(19);
  });

  it("rejects an invalid recipe with a CONFIG-style hint", async () => {
    const tmpDir = await setupTmpWorkspace();
    const recipePath = path.join(tmpDir, "bad.recipe.json");
    await fs.writeFile(recipePath, JSON.stringify({ kind: "wrong" }), "utf8");
    await expect(
      runRecipeCompile({
        config: tmpDir,
        input: recipePath,
        output: path.join(tmpDir, "out.ir.json"),
        templatesRoot: CONTEXT.templatesRoot,
        renderingsRoot: CONTEXT.renderingsRoot,
        enumerationsRoot: CONTEXT.enumerationsRoot,
        json: true,
        quiet: true,
      })
    ).rejects.toThrow(/Invalid recipe/);
  });
});
