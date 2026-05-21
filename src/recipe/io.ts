import { promises as fs } from "node:fs";
import path from "node:path";
import { ScaiError, createScaiError } from "@/shared/errors";
import { type Recipe, RecipeSchema } from "./schema/recipe";
import { OperationIrSchema, type OperationIr } from "./ir/operations";
import type { Plan } from "./runtime/plan";
import { isRecipeSandboxEnabled, loadRecipeInSandbox } from "./sandbox/load";

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
 *   - `.recipe.ts` — TypeScript source compiled at runtime via `tsx/cjs/api`.
 *     Recipes export the recipe object as either the default export or a
 *     named export (the first one found wins).
 *   - `.recipe.json` — pre-serialized recipe JSON.
 *
 * Validates against `RecipeSchema` (the `Recipe = ComponentTemplateRecipe |
 * ContentTemplateRecipe` discriminated union) so both kinds parse uniformly.
 */
export const loadRecipe = async (filePath: string): Promise<Recipe> => {
  const ext = path.extname(filePath).toLowerCase();
  const raw =
    ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts"
      ? await loadRecipeFromTypeScript(filePath)
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

/**
 * Lazily install tsx's CommonJS require hook *once* per process. Earlier
 * versions of this file called `register()` and the matching `unregister`
 * cleanup on every `loadRecipe` call — fine for one-shot CLI runs but
 * wasteful in long-running surfaces like `scai cli shell` where N recipe
 * loads = N register/unregister cycles. Once installed, the hook stays
 * for the rest of the process lifetime; recipe changes mid-shell-session
 * therefore require an exit (the per-recipe `require.cache` clear below
 * handles re-imports of the *same* file path within the same process).
 */
let tsxRegistered = false;
const ensureTsxRegistered = (): void => {
  if (tsxRegistered) {
    return;
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const tsxApi = require("tsx/cjs/api") as { register: () => () => void };
  /* eslint-enable @typescript-eslint/no-require-imports */
  tsxApi.register();
  tsxRegistered = true;
};

let sandboxOptOutWarned = false;
const warnSandboxDisabled = (): void => {
  if (sandboxOptOutWarned) {
    return;
  }
  sandboxOptOutWarned = true;
  process.stderr.write(
    "scai: SITECOREAI_RECIPE_SANDBOX=0 — loading .recipe.ts in-process; " +
      "a hostile recipe runs with scai's full privileges.\n"
  );
};

/**
 * Load a `.recipe.ts` and return its exported recipe object. By default the
 * file is loaded in a confined child process (see docs/recipe-sandbox.md) so
 * a hostile recipe a weaponized config could point at cannot run with scai's
 * privileges. `SITECOREAI_RECIPE_SANDBOX=0` forces the legacy in-process load.
 */
const loadRecipeFromTypeScript = async (filePath: string): Promise<unknown> => {
  if (isRecipeSandboxEnabled()) {
    return loadRecipeInSandbox(filePath);
  }
  warnSandboxDisabled();
  return loadRecipeInProcess(filePath);
};

const loadRecipeInProcess = async (filePath: string): Promise<unknown> => {
  const absolute = path.resolve(filePath);
  try {
    ensureTsxRegistered();
    if (require.cache[absolute]) {
      delete require.cache[absolute];
    }
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mod = require(absolute) as Record<string, unknown> & { default?: unknown };
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (mod.default !== undefined) {
      return mod.default;
    }
    // Fall back to the first non-default exported value.
    for (const key of Object.keys(mod)) {
      if (key !== "default" && mod[key] !== undefined) {
        return mod[key];
      }
    }
    throw createScaiError(`Recipe at ${filePath} has no exports.`, "INPUT_INVALID", {
      hint: "Add `export default <recipe>` (or any named export) to the file.",
    });
  } catch (error) {
    // Don't double-wrap our own CliErrors (e.g. "Recipe at <path> has no exports.").
    if (error instanceof ScaiError) {
      throw error;
    }
    throw createScaiError(
      `Failed to load recipe TypeScript file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "INPUT_INVALID",
      { hint: "Confirm the file compiles standalone (try `pnpm exec tsx <file>`)." }
    );
  }
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
