import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRecipeCompile } from "../../../../src/recipe/tasks/compile";
import { ctaButtonRecipe } from "../../../../example/recipes/cta-button.recipe";

const CONTEXT = {
  templatesRoot: "/sitecore/templates/Project/sandbox/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/sandbox",
};

describe("runRecipeCompile", () => {
  it("reads a recipe.json and writes an Operation IR JSON file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-recipe-compile-"));
    const recipePath = path.join(tmpDir, "cta-button.recipe.json");
    const irPath = path.join(tmpDir, "cta-button.ir.json");
    await fs.writeFile(recipePath, JSON.stringify(ctaButtonRecipe), "utf8");

    await runRecipeCompile({
      input: recipePath,
      output: irPath,
      templatesRoot: CONTEXT.templatesRoot,
      renderingsRoot: CONTEXT.renderingsRoot,
      json: true,
      quiet: true,
    });

    const written = JSON.parse(await fs.readFile(irPath, "utf8"));
    expect(written.schemaVersion).toBe("1");
    expect(written.recipeHandle).toBe("cta-button@1");
    expect(written.operations).toHaveLength(17);
  });

  it("rejects an invalid recipe with a CONFIG-style hint", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-recipe-compile-"));
    const recipePath = path.join(tmpDir, "bad.recipe.json");
    await fs.writeFile(recipePath, JSON.stringify({ kind: "wrong" }), "utf8");
    await expect(
      runRecipeCompile({
        input: recipePath,
        output: path.join(tmpDir, "out.ir.json"),
        templatesRoot: CONTEXT.templatesRoot,
        renderingsRoot: CONTEXT.renderingsRoot,
        json: true,
        quiet: true,
      })
    ).rejects.toThrow(/Invalid recipe/);
  });
});
