import { promises as fs } from "node:fs";
import path from "node:path";
import { createScaiError } from "@/shared/errors";
import { isTypeScriptRecipePath, loadTypeScriptRecipe } from "@/sync/typescript-recipe";
import { type Recipe, RecipeSchema } from "./schema/recipe";
import { OperationIrSchema, type OperationIr } from "./ir/operations";
import type { Plan } from "./runtime/plan";

/**
 * Recipe + IR + Plan I/O.
 *
 * Recipes ship as `.recipe.json` (the runtime contract — the registry
 * build emits these from authored `.recipe.ts` files). IR documents are
 * `.ir.json`. Plans, when persisted, are `.plan.json`. All three pass
 * through Zod parsing on read; structural drift surfaces here, not later
 * in the planner.
 */

const readJson = async (filePath: string): Promise<unknown> => {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw createScaiError(`File not found: ${filePath}`, "INPUT_INVALID", {
        hint: "Check the path spelling and that the file exists.",
      });
    }
    throw createScaiError(
      `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      "INPUT_INVALID"
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createScaiError(
      `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      "INPUT_INVALID",
      { hint: "Ensure the file contains a valid JSON document." }
    );
  }
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

/**
 * Load a recipe file. Supports both shapes:
 *
 *   - `.recipe.ts` (or `.tsx`/`.mts`/`.cts`) — TypeScript source compiled
 *     and executed in the recipe sandbox. Recipes export the recipe
 *     object as either the default export or a named export (the first
 *     one found wins).
 *   - `.recipe.json` — pre-serialized recipe JSON.
 *
 * The TypeScript path is shared with the schema-aware loader at
 * `@/sync/typescript-recipe` so brand-kit, agent, campaign, and brief
 * recipes can also be authored as `.recipe.ts`.
 *
 * Validates against `RecipeSchema` (the `Recipe = ComponentTemplateRecipe |
 * ContentTemplateRecipe` discriminated union) so both kinds parse uniformly.
 */
export const loadRecipe = async (filePath: string): Promise<Recipe> => {
  const raw = isTypeScriptRecipePath(filePath)
    ? await loadTypeScriptRecipe(filePath)
    : await readJson(filePath);

  const result = RecipeSchema.safeParse(raw);
  if (!result.success) {
    throw createScaiError(`Invalid recipe at ${filePath}.`, "INPUT_INVALID", {
      hint: "Ensure the file exports a `ComponentTemplateRecipe` or `ContentTemplateRecipe`.",
      details: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
      ),
    });
  }
  return result.data;
};

export const writeIr = async (filePath: string, ir: OperationIr): Promise<void> => {
  await writeJson(filePath, ir);
};

export const loadIr = async (filePath: string): Promise<OperationIr> => {
  const json = await readJson(filePath);
  const result = OperationIrSchema.safeParse(json);
  if (!result.success) {
    throw createScaiError(`Invalid Operation IR at ${filePath}.`, "INPUT_INVALID", {
      hint: "Re-run `scai provision recipe compile` to regenerate the IR.",
      details: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
      ),
    });
  }
  return result.data;
};

export const writePlan = async (filePath: string, plan: Plan): Promise<void> => {
  await writeJson(filePath, plan);
};

export const defaultIrPath = (recipeHandle: string, baseDir: string): string =>
  path.join(baseDir, ".scai", `${slugifyHandle(recipeHandle)}.ir.json`);

export const defaultPlanPath = (recipeHandle: string, baseDir: string): string =>
  path.join(baseDir, ".scai", `${slugifyHandle(recipeHandle)}.plan.json`);

const slugifyHandle = (handle: string): string => handle.replace(/@/g, "_v");
