import path from "node:path";
import type { EnvironmentConfiguration } from "@/config/types";
import { readRootConfiguration } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import { compileRecipeSet } from "../compile";
import { defaultIrPath, loadRecipe, writeIr } from "../io";
import {
  recipeSetNeedsRoots,
  resolveRecipeInputs,
  resolveRecipeRoots,
  resolveSeedSite,
  resolveSitePathSegment,
  toLogger,
  withDerivedRecipeRoots,
  type RecipeCompileOptions,
} from "./shared";

/**
 * Resolve every optional compile root from CLI flag → active env
 * profile. `templatesRoot` / `renderingsRoot` are resolved separately
 * (they carry a required-ness signal); everything here is a pure
 * flag-or-profile fallback, so this stays a flat property map.
 */
const resolveOptionalRoots = (
  options: RecipeCompileOptions,
  environment: EnvironmentConfiguration | undefined
) => ({
  // Per-site folder layout roots — optional. When unset the
  // compiler falls back to `templatesRoot` for both, which means
  // section-aware components nest under templatesRoot (mid-migration
  // fallback) and content templates land mixed in with components.
  componentsRoot: options.componentsRoot ?? environment?.componentsRoot,
  contentModelsRoot: options.contentModelsRoot ?? environment?.contentModelsRoot,
  // Composition roots — optional. The per-recipe compile fns
  // throw with their own clear messages when a partial-design /
  // page-design / content-item recipe is in play but the corresponding
  // root is missing.
  partialDesignsRoot: options.partialDesignsRoot ?? environment?.partialDesignsRoot,
  pageDesignsRoot: options.pageDesignsRoot ?? environment?.pageDesignsRoot,
  contentItemsRoot: options.contentItemsRoot ?? environment?.contentItemsRoot,
  headlessVariantsRoot: options.headlessVariantsRoot ?? environment?.headlessVariantsRoot,
  availableRenderingsRoot: options.availableRenderingsRoot ?? environment?.availableRenderingsRoot,
  enumerationsRoot: options.enumerationsRoot ?? environment?.enumerationsRoot,
  // Page-level roots. `pageTemplatesRoot` falls back to `templatesRoot`
  // inside the compiler; `placeholderSettingsRoot` has no fallback —
  // `buildPlaceholderSettingsAggregate` errors when a set declares
  // placeholders but the root is unset.
  pageTemplatesRoot: environment?.pageTemplatesRoot,
  placeholderSettingsRoot: environment?.placeholderSettingsRoot,
  pagesRoot: environment?.pagesRoot,
});

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
  // Backfill recipeRoots derived from `site` + `siteCollection` before any
  // root lookup, so the optional roots (headless variants, enumerations,
  // placeholder settings) derive too — not just templates/renderings (which
  // `resolveRecipeRoots` derives on its own). Mirrors push's up-front derive.
  const environment = withDerivedRecipeRoots(envName ? root.environments[envName] : undefined);

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
  const optionalRoots = resolveOptionalRoots(options, environment);

  const results: Array<{
    recipeHandle: string;
    input: string;
    output: string;
    operationCount: number;
  }> = [];

  // Compile the whole set in one pass (not per-recipe), so cross-recipe
  // references — `section`, treelist sources, enum handles — resolve and the
  // cross-recipe aggregates (available renderings, placeholder settings,
  // templates mapping) are emitted. This mirrors `push`, making `compile` a
  // faithful no-tenant validation: a broken `section` ref now errors here
  // instead of only at push time, and the Available Renderings IR lands on
  // disk for inspection.
  const recipes = loaded.map((entry) => entry.recipe);
  const fileByHandle = new Map(loaded.map((entry) => [entry.recipe.handle, entry.file]));
  const irs = compileRecipeSet(recipes, {
    templatesRoot,
    renderingsRoot,
    ...optionalRoots,
    site: resolveSeedSite(environment),
    sitePathSegment: resolveSitePathSegment(environment),
    marketplacePluginOverrides: root.marketplacePluginOverrides,
  });

  if (options.output && irs.length > 1) {
    throw createScaiError("--output cannot be combined with a multi-IR compile.", "INPUT_INVALID", {
      hint: "A recipe-set compile emits one IR per recipe plus cross-recipe aggregates; omit --output to write per-recipe IRs to <dir>/.scai/.",
    });
  }

  // Per-recipe IRs land next to their source file; cross-recipe aggregate IRs
  // (no source file) land under the config root's `.scai/`.
  const aggregateDir = path.dirname(root.physicalPath);
  for (const ir of irs) {
    const sourceFile = fileByHandle.get(ir.recipeHandle);
    const baseDir = sourceFile ? path.dirname(path.resolve(sourceFile)) : aggregateDir;
    const outputPath = options.output ?? defaultIrPath(ir.recipeHandle, baseDir);
    await writeIr(outputPath, ir);

    results.push({
      recipeHandle: ir.recipeHandle,
      input: sourceFile ?? "(aggregate)",
      output: outputPath,
      operationCount: ir.operations.length,
    });

    if (!logger.isJson()) {
      logger.info(`Compiled ${ir.recipeHandle} → ${outputPath}`, "green");
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
