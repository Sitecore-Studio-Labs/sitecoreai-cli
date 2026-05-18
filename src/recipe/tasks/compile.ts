import path from "node:path";
import { readRootConfiguration } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import { compileRecipe } from "../compile";
import { defaultIrPath, loadRecipe, writeIr } from "../io";
import {
  recipeSetNeedsRoots,
  resolveRecipeInputs,
  resolveRecipeRoots,
  toLogger,
  type RecipeCompileOptions,
} from "./shared";

/**
 * `scai provision recipe compile` — pure-logic: recipe (.ts or .json) → Operation IR JSON.
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

  const envName = options.environmentName ?? root.defaultEnvironment;
  const environment = envName ? root.environments[envName] : undefined;

  const { files, source } = await resolveRecipeInputs(options, root);

  if (options.output && files.length > 1) {
    throw createScaiError("--output cannot be combined with multi-file compile.", "INPUT_INVALID", {
      hint: "Compile a single recipe with --input <file> --output <ir>, or omit --output to write per-recipe IRs to <dir>/<handle>.ir.json.",
    });
  }

  // Load every recipe up front so the templatesRoot / renderingsRoot
  // requirement can be scoped to what the set actually compiles — a
  // workflow- / webhook-authorization-only set creates its items under
  // hardcoded /sitecore/system roots and needs neither.
  const loaded = await Promise.all(
    files.map(async (file) => ({ file, recipe: await loadRecipe(file) }))
  );

  // Resolve parent paths from CLI flags or active env profile (when given).
  const { templatesRoot, renderingsRoot } = resolveRecipeRoots(
    options,
    environment,
    envName ?? "(no environment)",
    recipeSetNeedsRoots(loaded.map((entry) => entry.recipe))
  );
  // Phase 2 per-site folder layout roots — optional. When unset the
  // compiler falls back to `templatesRoot` for both, which means
  // section-aware components nest under templatesRoot (mid-migration
  // fallback) and content templates land mixed in with components.
  const componentsRoot = options.componentsRoot ?? environment?.componentsRoot;
  const contentModelsRoot = options.contentModelsRoot ?? environment?.contentModelsRoot;
  // Phase 4 composition roots — optional. The per-recipe compile fns
  // throw with their own clear messages when a partial-design /
  // page-design / content-item recipe is in play but the corresponding
  // root is missing.
  const partialDesignsRoot = options.partialDesignsRoot ?? environment?.partialDesignsRoot;
  const pageDesignsRoot = options.pageDesignsRoot ?? environment?.pageDesignsRoot;
  const contentItemsRoot = options.contentItemsRoot ?? environment?.contentItemsRoot;
  const headlessVariantsRoot = options.headlessVariantsRoot ?? environment?.headlessVariantsRoot;
  const availableRenderingsRoot =
    options.availableRenderingsRoot ?? environment?.availableRenderingsRoot;
  const enumerationsRoot = options.enumerationsRoot ?? environment?.enumerationsRoot;
  // Page-level roots. `pageTemplatesRoot` falls back to `templatesRoot`
  // inside the compiler; `placeholderSettingsRoot` has no fallback —
  // `buildPlaceholderSettingsAggregate` errors when a set declares
  // placeholders but the root is unset.
  const pageTemplatesRoot = environment?.pageTemplatesRoot;
  const placeholderSettingsRoot = environment?.placeholderSettingsRoot;
  const pagesRoot = environment?.pagesRoot;

  const results: Array<{
    recipeHandle: string;
    input: string;
    output: string;
    operationCount: number;
  }> = [];

  for (const { file, recipe } of loaded) {
    const ir = compileRecipe(recipe, {
      templatesRoot,
      renderingsRoot,
      componentsRoot,
      contentModelsRoot,
      partialDesignsRoot,
      pageDesignsRoot,
      contentItemsRoot,
      headlessVariantsRoot,
      availableRenderingsRoot,
      enumerationsRoot,
      pageTemplatesRoot,
      placeholderSettingsRoot,
      pagesRoot,
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
