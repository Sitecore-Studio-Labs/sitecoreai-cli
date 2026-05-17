import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScaiError } from "../../../src/shared/errors";
import { isRecipeSandboxEnabled, loadRecipeInSandbox } from "../../../src/recipe/sandbox/load";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-recipe-sb-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeRecipe = (name: string, body: string): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
};

describe("recipe sandbox", () => {
  it("round-trips a benign recipe's exported data", async () => {
    const file = writeRecipe(
      "ok.recipe.ts",
      `export default { kind: "component-template", handle: "x@1", value: 42 };`
    );
    const result = await loadRecipeInSandbox(file);
    expect(result).toEqual({ kind: "component-template", handle: "x@1", value: 42 });
  });

  it("surfaces a clean ScaiError when a recipe throws on load", async () => {
    const file = writeRecipe("boom.recipe.ts", `throw new Error("recipe boom");`);
    await expect(loadRecipeInSandbox(file)).rejects.toBeInstanceOf(ScaiError);
  });

  it("withholds scai secrets from the child environment", async () => {
    process.env.SITECOREAI_DEPLOY_TOKEN = "super-secret-token";
    try {
      const file = writeRecipe(
        "env.recipe.ts",
        `export default { leaked: process.env.SITECOREAI_DEPLOY_TOKEN ?? null };`
      );
      const result = await loadRecipeInSandbox(file);
      expect(result).toEqual({ leaked: null });
    } finally {
      delete process.env.SITECOREAI_DEPLOY_TOKEN;
    }
  });

  it("kills a recipe that hangs and rejects with a timeout error", async () => {
    const prior = process.env.SITECOREAI_RECIPE_SANDBOX_TIMEOUT_MS;
    process.env.SITECOREAI_RECIPE_SANDBOX_TIMEOUT_MS = "500";
    try {
      const file = writeRecipe(
        "hang.recipe.ts",
        `const until = Date.now() + 60000;\nwhile (Date.now() < until) {}\nexport default {};`
      );
      await expect(loadRecipeInSandbox(file)).rejects.toThrow(/timed out/);
    } finally {
      if (prior === undefined) {
        delete process.env.SITECOREAI_RECIPE_SANDBOX_TIMEOUT_MS;
      } else {
        process.env.SITECOREAI_RECIPE_SANDBOX_TIMEOUT_MS = prior;
      }
    }
  });

  it("refuses a filesystem write attempted from inside the sandbox", async () => {
    const target = path.join(dir, "recipe-must-not-write-this.txt");
    const file = writeRecipe(
      "writer.recipe.ts",
      `import fs from "node:fs";\n` +
        `fs.writeFileSync(${JSON.stringify(target)}, "x");\n` +
        `export default {};`
    );
    await expect(loadRecipeInSandbox(file)).rejects.toBeInstanceOf(ScaiError);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("isRecipeSandboxEnabled honours the SITECOREAI_RECIPE_SANDBOX opt-out", () => {
    const prior = process.env.SITECOREAI_RECIPE_SANDBOX;
    try {
      delete process.env.SITECOREAI_RECIPE_SANDBOX;
      expect(isRecipeSandboxEnabled()).toBe(true);
      process.env.SITECOREAI_RECIPE_SANDBOX = "0";
      expect(isRecipeSandboxEnabled()).toBe(false);
    } finally {
      if (prior === undefined) {
        delete process.env.SITECOREAI_RECIPE_SANDBOX;
      } else {
        process.env.SITECOREAI_RECIPE_SANDBOX = prior;
      }
    }
  });
});
