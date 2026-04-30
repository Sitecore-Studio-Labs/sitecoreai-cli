import path from "node:path";
import { readRootConfiguration } from "@/config";
import { createCliError } from "@/shared/errors";
import { compileRecipe } from "../compile";
import { defaultIrPath, loadRecipe, writeIr } from "../io";
import {
  resolveRecipeInputs,
  resolveRecipeRoots,
  toLogger,
  type RecipeCompileOptions,
} from "./shared";

/**
 * `scai recipe compile` — pure-logic: recipe (.ts or .json) → Operation IR JSON.
 *
 * Resolves inputs from `--input` (single file) or the config `recipes`
 * glob (zero-to-many files). Writes one IR per recipe at
 * `--output` (single mode) or `<dir>/<handle>.ir.json` (multi mode).
 *
 * No tenant access — the IR is tenant-shaped (`templatesRoot`,
 * `renderingsRoot` are CLI inputs), so re-compile if the same recipe
 * lands in a different tenant tree.
 */
export const runRecipeCompile = async (options: RecipeCompileOptions): Promise<void> => {
  const logger = toLogger(options);
  const root = readRootConfiguration(options.config ?? process.cwd(), options.environmentName);

  // Resolve parent paths from CLI flags or active env profile (when given).
  const envName = options.environmentName ?? root.defaultEnvironment;
  const environment = envName ? root.environments[envName] : undefined;
  const { templatesRoot, renderingsRoot } = resolveRecipeRoots(
    options,
    environment,
    envName ?? "(no environment)"
  );
  // Phase 4 composition roots — optional. The per-recipe compile fns
  // throw with their own clear messages when a partial-design /
  // page-design / content-item recipe is in play but the corresponding
  // root is missing.
  const partialDesignsRoot = options.partialDesignsRoot ?? environment?.partialDesignsRoot;
  const pageDesignsRoot = options.pageDesignsRoot ?? environment?.pageDesignsRoot;
  const contentItemsRoot = options.contentItemsRoot ?? environment?.contentItemsRoot;

  const { files, source } = await resolveRecipeInputs(options, root);

  if (options.output && files.length > 1) {
    throw createCliError("--output cannot be combined with multi-file compile.", "INPUT_INVALID", {
      hint: "Compile a single recipe with --input <file> --output <ir>, or omit --output to write per-recipe IRs to <dir>/<handle>.ir.json.",
    });
  }

  const results: Array<{
    recipeHandle: string;
    input: string;
    output: string;
    operationCount: number;
  }> = [];

  for (const file of files) {
    const recipe = await loadRecipe(file);
    const ir = compileRecipe(recipe, {
      templatesRoot,
      renderingsRoot,
      partialDesignsRoot,
      pageDesignsRoot,
      contentItemsRoot,
    });

    const outputPath =
      options.output ?? defaultIrPath(recipe.handle, path.dirname(path.resolve(file)));
    await writeIr(outputPath, ir);

    results.push({
      recipeHandle: recipe.handle,
      input: file,
      output: outputPath,
      operationCount: ir.operations.length,
    });

    if (!logger.isJson()) {
      logger.info(`Compiled ${recipe.handle} → ${outputPath}`, "green");
      logger.info(`  ${ir.operations.length} operation${ir.operations.length === 1 ? "" : "s"}.`);
    }
  }

  if (logger.isJson()) {
    logger.json({
      command: "recipe.compile",
      source,
      results,
    });
  }
};
