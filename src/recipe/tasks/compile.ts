import path from "node:path";
import type { EnvironmentConfiguration } from "@/config/types";
import { readRootConfiguration } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import { discoverSites } from "@/authoring";
import { createAuthoringClient } from "../api/authoring-client";
import { compileRecipeSet } from "../compile";
import { defaultIrPath, irFileName, loadRecipe, writeIr } from "../io";
import { alignMediaLibraryRootWithSite } from "./media-root";
import { resolveScopedLanguages } from "./scoped-languages";
import {
  loadImageDefaults,
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
  mediaLibraryRoot: options.mediaLibraryRoot ?? environment?.mediaLibraryRoot,
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
 * `scai provision recipe compile` — recipe (.ts or .json) → Operation IR JSON.
 *
 * Resolves inputs from `--input` (single file) or the config `recipes`
 * glob (zero-to-many files). Writes one IR per recipe at `--output`
 * (single mode), `<dir>/<handle>.ir.json` under each source's `.scai/`
 * (default multi mode), or a flat `--output-dir` artifact (the input for
 * `push --from-compiled`).
 *
 * Tenant access is OPTIONAL and gated on `-n`: with an environment, the
 * two tenant-derived COMPILE inputs `recipe push` resolves — the
 * `--languages` installed-locale intersection and media-root alignment —
 * are resolved here too, so a precompiled artifact carries the SAME
 * localized surface + media paths a compiling push would produce. Without
 * `-n` it stays pure-logic (every authored locale emitted, configured
 * media root). Either way the IR is tenant-tree-shaped (`templatesRoot`
 * etc. are inputs), so re-compile if the same recipe lands in a different
 * tenant tree.
 */
export const runRecipeCompile = async (options: RecipeCompileOptions): Promise<void> => {
  const logger = toLogger(options);
  const root = readRootConfiguration(options.config ?? process.cwd(), options.environmentName);

  if (options.output && options.outputDir) {
    throw createScaiError("--output and --output-dir are mutually exclusive.", "INPUT_INVALID", {
      hint: "Use --output <file> for a single-IR compile, or --output-dir <dir> to collect the whole set as the `push --from-compiled` artifact.",
    });
  }

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
  const imageDefaults = await loadImageDefaults(options.imageDefaults);

  // Tenant-derived COMPILE inputs — resolved exactly as `recipe push` does
  // so `push --from-compiled` applies the same surface a compiling push
  // would. Both are best-effort (fail-open to the offline default) and gated
  // on an environment being resolvable: `availableLanguages` scopes which
  // localized ops are emitted (per `--languages`), and the aligned media
  // root is baked into media ops. Without `-n` neither runs — the offline
  // compile emits every authored locale against the configured media root.
  const availableLanguages = environment
    ? await resolveScopedLanguages(recipes, environment, options.languages)
    : undefined;
  const mediaLibraryRootAligned = environment
    ? await alignMediaLibraryRootWithSite({
        configuredRoot: optionalRoots.mediaLibraryRoot,
        explicitFlag: options.mediaLibraryRoot,
        site: environment.site,
        discover: () => discoverSites(environment),
        getItemsByPaths: (paths) => createAuthoringClient({ environment }).getItemsByPaths(paths),
        logger,
      })
    : optionalRoots.mediaLibraryRoot;

  const irs = compileRecipeSet(recipes, {
    templatesRoot,
    renderingsRoot,
    ...optionalRoots,
    mediaLibraryRoot: mediaLibraryRootAligned,
    ...(imageDefaults ? { imageDefaults } : {}),
    ...(availableLanguages ? { availableLanguages } : {}),
    site: resolveSeedSite(environment),
    sitePathSegment: resolveSitePathSegment(environment),
    marketplacePluginOverrides: root.marketplacePluginOverrides,
  });

  if (options.output && irs.length > 1) {
    throw createScaiError("--output cannot be combined with a multi-IR compile.", "INPUT_INVALID", {
      hint: "A recipe-set compile emits one IR per recipe plus cross-recipe aggregates; omit --output to write per-recipe IRs to <dir>/.scai/.",
    });
  }

  // `--output-dir` collects the WHOLE set flat into one directory — the
  // artifact `push --from-compiled` consumes. Otherwise per-recipe IRs land
  // next to their source file and cross-recipe aggregate IRs (no source
  // file) under the config root's `.scai/`.
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : undefined;
  const aggregateDir = path.dirname(root.physicalPath);
  for (const ir of irs) {
    const sourceFile = fileByHandle.get(ir.recipeHandle);
    const baseDir = sourceFile ? path.dirname(path.resolve(sourceFile)) : aggregateDir;
    const outputPath = outputDir
      ? path.join(outputDir, irFileName(ir.recipeHandle))
      : (options.output ?? defaultIrPath(ir.recipeHandle, baseDir));
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
