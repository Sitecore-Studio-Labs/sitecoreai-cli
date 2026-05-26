import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { loadRecipe, writeRecipe } from "../../../src/sync/io";

const schema = z.object({ name: z.string(), tags: z.array(z.string()).default([]) });

const withTempDir = async (run: (dir: string) => Promise<void> | void): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "scai-io-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const writeFile = (path: string, body: string): void => writeFileSync(path, body, "utf8");

describe("writeRecipe + loadRecipe — YAML / JSON path", () => {
  it("round-trips a recipe through YAML", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "demo.yaml");
      writeRecipe(file, { name: "Acme", tags: ["a", "b"] });
      await expect(loadRecipe(file, schema)).resolves.toEqual({
        name: "Acme",
        tags: ["a", "b"],
      });
    });
  });

  it("round-trips through JSON when the path ends .json", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "demo.json");
      writeRecipe(file, { name: "Acme", tags: [] });
      await expect(loadRecipe(file, schema)).resolves.toEqual({ name: "Acme", tags: [] });
    });
  });

  it("throws INPUT_INVALID for a missing file", async () => {
    await expect(loadRecipe("/no/such/scai-recipe.yaml", schema)).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringMatching(/Cannot read/i),
    });
  });

  it("throws INPUT_INVALID with validation detail when the YAML fails the schema", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "bad.yaml");
      writeRecipe(file, { tags: "not-an-array" });
      await expect(loadRecipe(file, schema)).rejects.toMatchObject({
        code: "INPUT_INVALID",
        message: expect.stringMatching(/failed schema validation/i),
        details: expect.arrayContaining([expect.stringMatching(/tags/)]),
      });
    });
  });
});

/**
 * The TypeScript path runs the recipe in a forked Node sandbox child;
 * starting it costs ~hundreds of ms. We opt the tests out of the sandbox
 * so they run in-process via `tsx/cjs/api` — same code path the loader
 * uses when `SITECOREAI_RECIPE_SANDBOX=0`. The dedicated sandbox tests
 * in `tests/unit/recipe/sandbox.test.ts` cover the confined-child path.
 */
describe("loadRecipe — TypeScript path (sandbox disabled for speed)", () => {
  const prevSandbox = process.env.SITECOREAI_RECIPE_SANDBOX;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.SITECOREAI_RECIPE_SANDBOX = "0";
    // The loader warns on stderr when the sandbox is disabled — suppress
    // so test output stays clean. The CMS recipe loader test exercises
    // the warning path; no need to duplicate here.
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    if (prevSandbox === undefined) delete process.env.SITECOREAI_RECIPE_SANDBOX;
    else process.env.SITECOREAI_RECIPE_SANDBOX = prevSandbox;
    stderr.mockRestore();
  });

  it("loads a .ts recipe with a default export and Zod-validates it", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "demo.recipe.ts");
      writeFile(file, `export default { name: "Acme", tags: ["a"] };`);
      await expect(loadRecipe(file, schema)).resolves.toEqual({
        name: "Acme",
        tags: ["a"],
      });
    });
  });

  it("falls back to the first named export when there is no default", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "named.recipe.ts");
      writeFile(file, `export const recipe = { name: "Acme", tags: [] };`);
      await expect(loadRecipe(file, schema)).resolves.toEqual({
        name: "Acme",
        tags: [],
      });
    });
  });

  it("rejects with INPUT_INVALID when a .ts recipe has a syntax error", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "syntax.recipe.ts");
      writeFile(file, `export default { name: "Acme"`); // unterminated object
      await expect(loadRecipe(file, schema)).rejects.toMatchObject({
        code: "INPUT_INVALID",
      });
    });
  });

  it("rejects with the same INPUT_INVALID + details shape on Zod failure as the YAML path", async () => {
    await withTempDir(async (dir) => {
      const tsFile = join(dir, "wrong.recipe.ts");
      writeFile(tsFile, `export default { tags: "not-an-array" };`);

      const yamlFile = join(dir, "wrong.yaml");
      writeRecipe(yamlFile, { tags: "not-an-array" });

      // Drive both paths through the loader; assert identical error
      // shape so callers downstream of loadRecipe can treat them
      // uniformly. The exact message includes the path, so we match on
      // the structured fields instead.
      const tsErr = await loadRecipe(tsFile, schema).catch((e: unknown) => e);
      const yamlErr = await loadRecipe(yamlFile, schema).catch((e: unknown) => e);

      expect(tsErr).toMatchObject({
        code: "INPUT_INVALID",
        message: expect.stringMatching(/failed schema validation/i),
      });
      expect(yamlErr).toMatchObject({
        code: "INPUT_INVALID",
        message: expect.stringMatching(/failed schema validation/i),
      });
      // Both surface the same Zod issue list (modulo path differences).
      expect((tsErr as { details?: string[] }).details).toBeDefined();
      expect((yamlErr as { details?: string[] }).details).toBeDefined();
    });
  });

  it("loads a brand-kit-shaped .recipe.ts end-to-end through the brand schema", async () => {
    // Import lazily to keep the brand recipe schema out of the test
    // file's static deps if the module ever moves.
    const { BrandKitRecipeSchema } = await import("../../../src/brand/recipe/schema");
    await withTempDir(async (dir) => {
      const file = join(dir, "acme.brandkit.recipe.ts");
      writeFile(
        file,
        `export default {
           name: "Acme",
           description: "Demo brand for tests",
           industry: "developer-tools",
           documents: [],
           sections: { "Brand Context": { Mission: "Ship the truth." } },
         };`
      );
      const recipe = await loadRecipe(file, BrandKitRecipeSchema);
      expect(recipe).toMatchObject({
        name: "Acme",
        industry: "developer-tools",
        sections: { "Brand Context": { Mission: "Ship the truth." } },
      });
    });
  });
});
