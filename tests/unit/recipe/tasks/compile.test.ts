import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRecipeCompile } from "../../../../src/recipe/tasks/compile";
import { templateId } from "../../../../src/recipe/items/guids";
import { ctaButtonRecipe } from "../../../../example/recipes/cta-button.recipe";
import { blogArticleApproval } from "../../../../example/recipes/blog-article-approval.recipe";

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

  it("compiles a workflow recipe with no templatesRoot / renderingsRoot configured", async () => {
    const tmpDir = await setupTmpWorkspace();
    const recipePath = path.join(tmpDir, "blog-article-approval.recipe.json");
    const irPath = path.join(tmpDir, "blog-article-approval.ir.json");
    await fs.writeFile(recipePath, JSON.stringify(blogArticleApproval), "utf8");

    // No roots passed and none in the config — a workflow recipe creates
    // its items under the hardcoded /sitecore/system/Workflows root, so
    // the templatesRoot / renderingsRoot gate must not fire.
    await runRecipeCompile({
      config: tmpDir,
      input: recipePath,
      output: irPath,
      json: true,
      quiet: true,
    });

    const written = JSON.parse(await fs.readFile(irPath, "utf8"));
    expect(written.recipeHandle).toBe("blog-article-approval@1");
    expect(written.operations.length).toBeGreaterThan(0);
  });

  // Drives the env-profile → seed → GUID wire end-to-end: roots and the seed
  // come off the env profile (no CLI root flags), so a dropped `site:` in the
  // compile context would surface here as a "default"-seeded GUID.
  const compileCtaWithEnv = async (env: Record<string, unknown>): Promise<string[]> => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-recipe-seed-"));
    const cliConfig = JSON.stringify({
      modules: ["./fixtures/**/*.module.json"],
      envProfiles: { sandbox: env },
    });
    await fs.writeFile(path.join(tmpDir, "sitecoreai.cli.json"), cliConfig, "utf8");
    const recipePath = path.join(tmpDir, "cta-button.recipe.json");
    const irPath = path.join(tmpDir, "cta-button.ir.json");
    await fs.writeFile(recipePath, JSON.stringify(ctaButtonRecipe), "utf8");

    await runRecipeCompile({
      config: tmpDir,
      environmentName: "sandbox",
      input: recipePath,
      output: irPath,
      json: true,
      quiet: true,
    });

    const written = JSON.parse(await fs.readFile(irPath, "utf8"));
    return written.operations.map((op: { id: string }) => op.id);
  };

  describe("site-scoped GUIDs (env-profile seed wiring)", () => {
    const ENV_ROOTS = {
      templatesRoot: CONTEXT.templatesRoot,
      renderingsRoot: CONTEXT.renderingsRoot,
      headlessVariantsRoot: CONTEXT.headlessVariantsRoot,
      enumerationsRoot: CONTEXT.enumerationsRoot,
    };

    it("seeds GUIDs by 'default' when siteScopedGuids is unset, even though `site` is set", async () => {
      // The canary-protecting invariant: a `site` configured for recipeRoots
      // derivation must NOT flip GUID seeding. Without the opt-in, items stay
      // byte-identical to legacy 'default'-seeded GUIDs.
      const ids = await compileCtaWithEnv({ site: "siteA", ...ENV_ROOTS });
      expect(ids).toContain(templateId("default", "cta-button@1"));
      expect(ids).not.toContain(templateId("siteA", "cta-button@1"));
    });

    it("seeds GUIDs by the profile's site when siteScopedGuids is true", async () => {
      const ids = await compileCtaWithEnv({ site: "siteA", siteScopedGuids: true, ...ENV_ROOTS });
      expect(ids).toContain(templateId("siteA", "cta-button@1"));
      expect(ids).not.toContain(templateId("default", "cta-button@1"));
    });

    it("yields disjoint GUIDs across sites for the same recipe handle", async () => {
      // The whole point: the same handle on two sites no longer collides on
      // Sitecore's globally-unique item IDs.
      const a = await compileCtaWithEnv({ site: "siteA", siteScopedGuids: true, ...ENV_ROOTS });
      const b = await compileCtaWithEnv({ site: "siteB", siteScopedGuids: true, ...ENV_ROOTS });
      expect(a).toContain(templateId("siteA", "cta-button@1"));
      expect(b).toContain(templateId("siteB", "cta-button@1"));
      expect(a).not.toContain(templateId("siteB", "cta-button@1"));
    });

    it("throws when siteScopedGuids is enabled but no site is configured", async () => {
      await expect(compileCtaWithEnv({ siteScopedGuids: true, ...ENV_ROOTS })).rejects.toThrow(
        /siteScopedGuids is enabled/
      );
    });
  });

  it("--output-dir collects the whole set flat as <handle>.ir.json (the --from-compiled artifact)", async () => {
    const tmpDir = await setupTmpWorkspace();
    const recipePath = path.join(tmpDir, "cta-button.recipe.json");
    await fs.writeFile(recipePath, JSON.stringify(ctaButtonRecipe), "utf8");
    const outDir = path.join(tmpDir, "artifact");

    await runRecipeCompile({
      config: tmpDir,
      input: recipePath,
      outputDir: outDir,
      templatesRoot: CONTEXT.templatesRoot,
      renderingsRoot: CONTEXT.renderingsRoot,
      headlessVariantsRoot: CONTEXT.headlessVariantsRoot,
      enumerationsRoot: CONTEXT.enumerationsRoot,
      json: true,
      quiet: true,
    });

    // Flat in the output dir — no `.scai/` nesting — named by slugified handle
    // (`cta-button@1` → `cta-button_v1.ir.json`), ready for `--from-compiled`.
    const written = JSON.parse(
      await fs.readFile(path.join(outDir, "cta-button_v1.ir.json"), "utf8")
    );
    expect(written.recipeHandle).toBe("cta-button@1");
    expect(written.operations.length).toBeGreaterThan(0);
  });

  it("rejects --output combined with --output-dir", async () => {
    const tmpDir = await setupTmpWorkspace();
    const recipePath = path.join(tmpDir, "cta-button.recipe.json");
    await fs.writeFile(recipePath, JSON.stringify(ctaButtonRecipe), "utf8");

    await expect(
      runRecipeCompile({
        config: tmpDir,
        input: recipePath,
        output: path.join(tmpDir, "out.ir.json"),
        outputDir: path.join(tmpDir, "artifact"),
        templatesRoot: CONTEXT.templatesRoot,
        renderingsRoot: CONTEXT.renderingsRoot,
        json: true,
        quiet: true,
      })
    ).rejects.toThrow(/mutually exclusive/);
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
