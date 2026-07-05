import path from "node:path";
import fastGlob from "fast-glob";
import { Logger } from "@/shared/logger";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { deriveRecipeRoots } from "./derive-roots";
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "../api/authoring-client";
import type { AuthoringApiClient } from "../api/client";

/**
 * Shared option shapes for the three `scai provision recipe` tasks.
 *
 * All three honor the standard verbosity options (`--quiet`, `--json`,
 * `--log-file`). Plan and push additionally need an environment to talk
 * to a tenant; compile is pure-logic and doesn't.
 */

export interface RecipeCommonOptions {
  config?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

export interface RecipeCompileOptions extends RecipeCommonOptions {
  /** Single recipe file path. Defaults to the config `recipes` glob. */
  input?: string;
  output?: string;
  /** Override `templatesRoot` from the env profile. */
  templatesRoot?: string;
  /** Override `renderingsRoot` from the env profile. */
  renderingsRoot?: string;
  /** Override `componentsRoot` from the env profile (per-site folder layout). */
  componentsRoot?: string;
  /** Override `contentModelsRoot` from the env profile (per-site folder layout). */
  contentModelsRoot?: string;
  /** Override `partialDesignsRoot` from the env profile (Phase 4). */
  partialDesignsRoot?: string;
  /** Override `pageDesignsRoot` from the env profile (Phase 4). */
  pageDesignsRoot?: string;
  /** Override `contentItemsRoot` from the env profile (Phase 4). */
  contentItemsRoot?: string;
  /** Override `mediaLibraryRoot` from the env profile (recipe-materialised media). */
  mediaLibraryRoot?: string;
  /**
   * Path to a JSON image-defaults map (role → external URL). Image
   * values / SV defaults declaring a matching `role` materialise the
   * mapped URL instead of the recipe-authored one. Falls back to the
   * `SITECOREAI_IMAGE_DEFAULTS` env var (also a path).
   */
  imageDefaults?: string;
  /** Override `headlessVariantsRoot` from the env profile. */
  headlessVariantsRoot?: string;
  /** Override `availableRenderingsRoot` from the env profile. */
  availableRenderingsRoot?: string;
  /** Override `enumerationsRoot` from the env profile. */
  enumerationsRoot?: string;
  /**
   * Active env profile to source `templatesRoot` / `renderingsRoot`
   * defaults from when the flags are not passed. Required for compile
   * since compile is otherwise environment-agnostic.
   */
  environmentName?: string;
}

export interface RecipeTenantOptions extends RecipeCommonOptions {
  environmentName?: string;
  /**
   * Optional baseline storage backend. Defaults to a per-(env, recipe)
   * file under `<configDir>/.scai/baseline/`. Pass a custom
   * `BaselineStorage` instance (orchestrator-hosted, in-memory, etc.)
   * to share baselines across operators / CI without changing the
   * push / pull entry points.
   *
   * See `src/recipe/runtime/baseline.ts` for the `BaselineStorage`
   * interface contract. Caller is responsible for choosing storage
   * that's appropriate for the run (a remote storage in a CI flow,
   * file storage for local dev).
   */
  baselineStorage?: import("../runtime/baseline").BaselineStorage;
}

export interface RecipePlanOptions extends RecipeTenantOptions {
  /** Single IR file path. Defaults to the config `recipes` glob (compiled in-memory). */
  input?: string;
  output?: string;
  /**
   * Operator override for prune-rollback snapshot languages. Mirrors
   * the `--snapshot-languages` plumbing on `recipe push`; when unset,
   * the planner auto-discovers via `getTenantLanguages`. See
   * `RecipePushOptions.snapshotLanguages`.
   */
  snapshotLanguages?: readonly string[];
}

export interface RecipePushOptions extends RecipeTenantOptions {
  /** Single recipe file path. Defaults to the config `recipes` glob. */
  input?: string;
  /** Override `templatesRoot` from the env profile. */
  templatesRoot?: string;
  /** Override `renderingsRoot` from the env profile. */
  renderingsRoot?: string;
  /** Override `componentsRoot` from the env profile (per-site folder layout). */
  componentsRoot?: string;
  /** Override `contentModelsRoot` from the env profile (per-site folder layout). */
  contentModelsRoot?: string;
  /** Override `partialDesignsRoot` from the env profile (Phase 4). */
  partialDesignsRoot?: string;
  /** Override `pageDesignsRoot` from the env profile (Phase 4). */
  pageDesignsRoot?: string;
  /** Override `contentItemsRoot` from the env profile (Phase 4). */
  contentItemsRoot?: string;
  /** Override `mediaLibraryRoot` from the env profile (recipe-materialised media). */
  mediaLibraryRoot?: string;
  /**
   * Path to a JSON image-defaults map (role → external URL). Image
   * values / SV defaults declaring a matching `role` materialise the
   * mapped URL instead of the recipe-authored one. Falls back to the
   * `SITECOREAI_IMAGE_DEFAULTS` env var (also a path).
   */
  imageDefaults?: string;
  /** Override `headlessVariantsRoot` from the env profile. */
  headlessVariantsRoot?: string;
  /** Override `availableRenderingsRoot` from the env profile. */
  availableRenderingsRoot?: string;
  /** Override `enumerationsRoot` from the env profile. */
  enumerationsRoot?: string;
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * Operator consent to delete items via `PruneChildren` ops with
   * `mode: "delete"`. Independent of `allowWrite`: writes are always
   * gated by --apply + the policy tier; PRUNES are additionally gated
   * by this flag. Without it, a recipe IR containing a delete-mode
   * PruneChildren throws `POLICY_DENIED` rather than silently
   * degrading. Set via `--allow-prune` after reviewing the prune list
   * from a `--what-if` run.
   */
  allowPrune?: boolean;
  /**
   * Operator override for which languages prune-rollback snapshots
   * capture. When unset, the planner auto-discovers via the Authoring
   * API's tenant-level `languages { nodes { name } }` connection
   * (`getTenantLanguages` on the client). The XM Cloud schema does
   * NOT expose `Item.languages` — item-level discovery isn't possible,
   * so the planner enumerates tenant languages and probes each per
   * item via `getItemVersions`. Falls back to `["en"]` if the tenant
   * `languages` query errors. Set explicitly (comma-separated via
   * `--snapshot-languages`) to bound snapshot cost on tenants where
   * auto-discovery returns languages you don't want captured. The
   * first entry doubles as the inverse `createItem`'s language.
   */
  snapshotLanguages?: readonly string[];
  /**
   * When true, skip recipes whose compiled IR digest + env-profile roots
   * digest both match the persisted `.scai/recipe-cache.json` entry from
   * the previous successful push. Speedups re-pushes of an unchanged
   * recipe set on warm tenants. Off by default — out-of-band CMS edits
   * to recipe-auto-redetected until either the recipe source changes or
   * the cache is invalidated.
   */
  skipUnchangedRecipes?: boolean;
  /**
   * Optional handle filter. When set, only recipes whose `recipeHandle`
   * appears in this list are pushed; the rest are dropped after
   * compile. Matches the `handles` field convention used by the
   * orchestrator's brief/campaign sync plans so a `recipe-sync` worker
   * spawning scai can pass through a consistent narrow-by-handle flag.
   *
   * Filtering happens AFTER compile because cross-recipe references
   * need every recipe in the set to resolve. Unknown handles in the
   * list are ignored (logged at info); when every handle is unknown
   * the push degrades to a no-op rather than failing.
   */
  handles?: readonly string[];
  /**
   * Three-way merge conflict policy. Governs how the planner resolves
   * drift entries whose tenant value differs from the last-applied
   * baseline:
   *   - `"error"` (default) — apply blocks; per-conflict action gets
   *     status `"conflict"` and the recipe aborts before any writes.
   *   - `"recipe-wins"` — recipe value clobbers the tenant edit (matches
   *     the legacy two-way diff behaviour scai had before baselines
   *     existed).
   *   - `"cms-wins"` — tenant value is preserved, recipe-side change is
   *     dropped for this push (the recipe re-writes next time if the
   *     baseline still disagrees).
   *
   * Only matters when a baseline is loaded. Without one (`--no-baseline`
   * or first push to an env), every drift surfaces as `"update"` and
   * this flag has no effect.
   */
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
  /**
   * Opt out of three-way merge baseline loading + post-apply writing.
   * Use cases:
   *   - First-push test runs against a clean tenant where the operator
   *     doesn't want a baseline file polluting the workspace.
   *   - CI runs where the baseline isn't checked in and operator wants
   *     legacy recipe-wins behaviour.
   *   - Debugging: comparing pre-baseline vs with-baseline behaviour.
   *
   * Default `false` — baselines load and write automatically. The
   * baseline file lives at
   * `<configDir>/.scai/baseline/<env>/<slug(handle)>.baseline.json`
   * and is per-recipe per-environment.
   */
  noBaseline?: boolean;
  /**
   * Plan-mode parallelism across recipes. Plan reads are pure (no
   * mutations, no shared mutable refs across recipes), so plan-mode
   * IRs can run concurrently. Defaults to 4. Apply-mode always runs
   * sequentially — within a push, mutations land in topological order.
   */
  planConcurrency?: number;
  /**
   * Optional progress callback. Receives per-recipe execution events
   * as they happen (op-start / op-result / apply-start / apply-success
   * / apply-error / site-job-poll / rollback events). Used by external
   * orchestrators (e.g. `scai mcp serve`) to forward live progress to
   * a client. The CLI logger does not need this — it observes the same
   * events via its own internal collator.
   */
  emit?: (event: { recipe: string; event: import("../runtime/execute").ExecutionEvent }) => void;
  /**
   * Cooperative cancellation. When the signal fires, the executor
   * stops between operations, rolls back applied mutations, and the
   * per-recipe `ExecutionResult.aborted` is set to true.
   */
  signal?: AbortSignal;
}

export const toLogger = (options: RecipeCommonOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

export interface ResolvedTenant {
  envName: string;
  environment: EnvironmentConfiguration;
  root: RootConfiguration;
  client: AuthoringApiClient;
}

export const resolveTenant = (
  options: RecipeTenantOptions,
  clientOptions?: { pathItemIdCache?: Map<string, string> }
): ResolvedTenant => {
  const { envName, environment, root, timeoutMs } = resolveEnvironment(options);
  // Carry the org-scoped automation client's non-secret `clientId` from
  // the root config so the auth layer can pair it with the org-client
  // secret in the keychain (the tier-3 fallback for org-level profiles).
  const orgClientId = environment.organizationId
    ? root.orgClients[environment.organizationId]?.clientId
    : undefined;
  const client = createAuthoringClient({
    environment: { ...environment, orgClientId },
    request: { timeoutMs },
    ...(clientOptions?.pathItemIdCache && { pathItemIdCache: clientOptions.pathItemIdCache }),
  });
  return { envName, environment, root, client };
};

/**
 * Recipe kinds whose compilers create items under hardcoded
 * `/sitecore/system/*` roots and never read `templatesRoot` /
 * `renderingsRoot`:
 *   - `workflow`              → `/sitecore/system/Workflows`
 *   - `webhook-authorization` → `/sitecore/system/Settings/Webhooks/Authorizations`
 *
 * A recipe set built only from these kinds can compile, plan, and push
 * with neither root configured — see `recipeSetNeedsRoots`.
 */
const ROOTLESS_RECIPE_KINDS: ReadonlySet<string> = new Set(["workflow", "webhook-authorization"]);

/**
 * Whether a recipe set needs `templatesRoot` / `renderingsRoot` resolved.
 *
 * True when at least one recipe creates template / rendering items —
 * every kind except `ROOTLESS_RECIPE_KINDS`. An empty set (e.g. a push
 * fed only pre-compiled `.ir.json` inputs, which carry their roots baked
 * in) needs neither. New recipe kinds default to *needing* roots; add a
 * kind to `ROOTLESS_RECIPE_KINDS` only once its compiler is confirmed to
 * ignore both roots.
 */
export const recipeSetNeedsRoots = (recipes: readonly { kind: string }[]): boolean =>
  recipes.some((recipe) => !ROOTLESS_RECIPE_KINDS.has(recipe.kind));

/**
 * Backfill an env profile's recipe-root fields from `site` + `siteCollection`
 * when both are set and a given root is absent. Explicit `*Root` config wins
 * over derivation; CLI flags (applied by the resolvers below) win over both —
 * preserving the `flag > explicit config > derived` precedence.
 *
 * Returns the profile unchanged when it lacks `site`/`siteCollection`, so
 * existing explicit-roots configs are untouched. Auto-resolving the collection
 * from the environment (Sites API) lands in a later milestone; for now both
 * values must be present for derivation to apply. See
 * `plans/recipe-roots-derivation.md`.
 */
export const withDerivedRecipeRoots = (
  environment: EnvironmentConfiguration | undefined
): EnvironmentConfiguration | undefined => {
  if (!environment) return environment;
  const site = environment.site?.trim();
  const siteCollection = environment.siteCollection?.trim();
  if (!site || !siteCollection) return environment;
  const derived = deriveRecipeRoots(site, siteCollection);
  return {
    ...environment,
    templatesRoot: environment.templatesRoot ?? derived.templates,
    renderingsRoot: environment.renderingsRoot ?? derived.renderings,
    componentsRoot: environment.componentsRoot ?? derived.components,
    contentModelsRoot: environment.contentModelsRoot ?? derived.contentModels,
    partialDesignsRoot: environment.partialDesignsRoot ?? derived.partialDesigns,
    pageDesignsRoot: environment.pageDesignsRoot ?? derived.pageDesigns,
    pageTemplatesRoot: environment.pageTemplatesRoot ?? derived.pageTemplates,
    contentItemsRoot: environment.contentItemsRoot ?? derived.contentItems,
    mediaLibraryRoot: environment.mediaLibraryRoot ?? derived.mediaLibrary,
    headlessVariantsRoot: environment.headlessVariantsRoot ?? derived.headlessVariants,
    availableRenderingsRoot: environment.availableRenderingsRoot ?? derived.availableRenderings,
    presentationStylesRoot: environment.presentationStylesRoot ?? derived.presentationStyles,
    enumerationsRoot: environment.enumerationsRoot ?? derived.enumerations,
    placeholderSettingsRoots: environment.placeholderSettingsRoots ?? derived.placeholderSettings,
    placeholderSettingsRoot:
      environment.placeholderSettingsRoot ?? derived.placeholderSettingsCreate,
  };
};

/**
 * When an env profile sets `site` but not `siteCollection`, resolve the
 * collection (parent tenant) by discovering the environment's sites and
 * matching by name — so authors can configure just `site` and let scai fill in
 * the collection that recipeRoots derivation needs. No-op when `site` is unset
 * or `siteCollection` is already configured, so it never hits the network for
 * explicit-roots / collection-set configs.
 *
 * `discover` is injected (callers wire scai's `discoverSites`) to keep this
 * unit testable without a tenant. Throws a clear `INPUT_INVALID` when discovery
 * fails or no site matches, pointing at the explicit `siteCollection` escape
 * hatch. See `plans/recipe-roots-derivation.md`.
 */
export const ensureSiteCollection = async (
  environment: EnvironmentConfiguration | undefined,
  envName: string,
  discover: (
    environment: EnvironmentConfiguration
  ) => Promise<ReadonlyArray<{ name: string; tenantName: string }>>
): Promise<EnvironmentConfiguration | undefined> => {
  if (!environment) return environment;
  const site = environment.site?.trim();
  if (!site || environment.siteCollection?.trim()) return environment;
  let sites: ReadonlyArray<{ name: string; tenantName: string }>;
  try {
    sites = await discover(environment);
  } catch {
    throw createScaiError(
      `Could not resolve a site collection for site '${site}' in environment '${envName}': site discovery failed.`,
      "INPUT_INVALID",
      {
        hint: "Set `siteCollection` on the env profile to skip discovery, or verify connectivity and credentials for this environment.",
      }
    );
  }
  const match = sites.find(
    (candidate) => candidate.name.localeCompare(site, undefined, { sensitivity: "accent" }) === 0
  );
  const collection = match?.tenantName?.trim();
  if (!collection) {
    throw createScaiError(
      `Could not resolve a site collection: no site named '${site}' was found in environment '${envName}'.`,
      "INPUT_INVALID",
      {
        hint: "Set `siteCollection` on the env profile, or check that `site` matches a site name in this environment.",
      }
    );
  }
  return { ...environment, siteCollection: collection };
};

/**
 * Resolve the recipe parent paths that the compiler will use for top-level
 * template + rendering items.
 *
 * Lookup order:
 *   1. `--templates-root` / `--renderings-root` CLI flags
 *   2. `envProfiles[<name>].templatesRoot` / `.renderingsRoot` from
 *      sitecoreai.cli.json (env-overrides via
 *      `SITECOREAI_ENV_<NAME>_TEMPLATES_ROOT` / `_RENDERINGS_ROOT` apply
 *      at config-load time before this helper runs)
 *   3. When `required`, throws `INPUT_INVALID` with a hint pointing at
 *      the envProfile shape. When not required (a workflow- /
 *      webhook-authorization-only set, or an IR-only push), missing
 *      roots resolve to `""` — the compilers in play never read them.
 *
 * Pass `required` from `recipeSetNeedsRoots(recipes)` once the set's
 * recipe kinds are known.
 *
 * Tenant-specific because each site has its own
 * `/sitecore/templates/Project/<site>/Components` location. Putting roots
 * in config keeps the orchestrator's `recipe push` invocation
 * config-driven (no plan-schema fields, no extra arg plumbing).
 */
export const resolveRecipeRoots = (
  options: { templatesRoot?: string; renderingsRoot?: string },
  environment: EnvironmentConfiguration | undefined,
  envName: string,
  required = true
): { templatesRoot: string; renderingsRoot: string } => {
  const env = withDerivedRecipeRoots(environment);
  const templatesRoot = options.templatesRoot ?? env?.templatesRoot;
  const renderingsRoot = options.renderingsRoot ?? env?.renderingsRoot;
  if (!required) {
    // The recipe set in play never reads these roots — pass through
    // whatever's configured, or "" so the requirement doesn't block a
    // set that doesn't need it.
    return { templatesRoot: templatesRoot ?? "", renderingsRoot: renderingsRoot ?? "" };
  }
  if (!templatesRoot || !renderingsRoot) {
    const missing =
      !templatesRoot && !renderingsRoot
        ? "both roots"
        : !templatesRoot
          ? "templatesRoot"
          : "renderingsRoot";
    throw createScaiError(
      `Recipe parent path missing: ${missing} not configured for environment '${envName}'.`,
      "INPUT_INVALID",
      {
        hint: `Add 'templatesRoot' and 'renderingsRoot' to envProfiles.${envName} in sitecoreai.cli.json (or pass --templates-root / --renderings-root).`,
      }
    );
  }
  return { templatesRoot, renderingsRoot };
};

/**
 * Derive the GUID-seed site for an env profile.
 *
 * Recipe item GUIDs are `uuidv5(`${seed}::${handle}`)` where `seed` is
 * `CompileContext.site ?? "default"` (see `compile/shared.ts#siteOf`).
 * Returning `undefined` here leaves `context.site` unset, so the seed stays
 * `"default"` — byte-identical to legacy behavior for every profile that does
 * not opt in.
 *
 * When a profile sets `siteScopedGuids: true`, the seed becomes its `site`,
 * so the same recipe handle resolves to a *distinct* item per site (required
 * to install one recipe onto multiple sites in one Sitecore instance without
 * colliding on Sitecore's globally-unique item IDs).
 *
 * MUST be called from every compile path (push, pull, compile, sync) so the
 * write path and the read/diff paths agree on item GUIDs — a mismatch would
 * silently break the three-way merge.
 *
 * Throws `INPUT_INVALID` when scoping is enabled but no `site` is configured.
 */
export const resolveSeedSite = (
  environment: Pick<EnvironmentConfiguration, "siteScopedGuids" | "site"> | undefined
): string | undefined => {
  if (!environment?.siteScopedGuids) return undefined;
  const site = environment.site?.trim();
  if (!site) {
    throw createScaiError(
      "siteScopedGuids is enabled but no 'site' is set on the env profile.",
      "INPUT_INVALID",
      {
        hint: "Set 'site' (the SXA Headless site name) on the env profile, or remove 'siteScopedGuids'.",
      }
    );
  }
  return site;
};

/**
 * Derive the content-tree path segment for `{site}` substitution in
 * `PageRecipe.itemPath` — `<siteCollection>/<site>`, the SXA Headless
 * location every install targets (`/sitecore/content/<collection>/<site>`).
 *
 * Distinct from `resolveSeedSite` above on purpose: the GUID seed is an
 * identity concern (opt-in, defaults to the `default` sentinel so GUIDs
 * stay stable), while this is the physical tenant tree location. The old
 * behaviour substituted the GUID seed into `{site}` paths, so pages
 * landed in a phantom `/sitecore/content/default/` tree unless
 * `siteScopedGuids` happened to be on — and even then missed the
 * collection segment.
 *
 * Returns `undefined` when either value is missing; `compilePageRecipe`
 * throws a targeted INPUT_INVALID only when a `{site}` itemPath actually
 * needs it, so site-less sets (workflow-only, component-only) compile
 * unchanged.
 */
export const resolveSitePathSegment = (
  environment: Pick<EnvironmentConfiguration, "site" | "siteCollection"> | undefined
): string | undefined => {
  const site = environment?.site?.trim();
  const collection = environment?.siteCollection?.trim();
  if (!site || !collection) return undefined;
  return `${collection}/${site}`;
};

export interface RecipeInputResolution {
  files: string[];
  source: "input-flag" | "config-glob";
}

/**
 * Resolve the recipe files a task should operate on. Precedence:
 *   1. `--input <file>` if provided (single file).
 *   2. `recipes` globs from sitecoreai.cli.json (zero, one, or many files).
 *
 * Returns absolute paths. Throws `INPUT_INVALID` when neither path resolves
 * to any files — telling the user how to fix it.
 */
export const resolveRecipeInputs = async (
  options: { input?: string; config?: string },
  root: RootConfiguration
): Promise<RecipeInputResolution> => {
  if (options.input) {
    return { files: [path.resolve(options.input)], source: "input-flag" };
  }
  const configDir = path.dirname(root.physicalPath);
  // followSymbolicLinks: false defends against an attacker-planted symlink
  // in recipes/ pointing at /etc/, ~/.aws/, or any other sensitive TS file
  // — those files would otherwise be executed by tsx when the recipe gets
  // loaded (.recipe.ts is code, not data).
  const matched = await fastGlob(root.recipes, {
    cwd: configDir,
    absolute: true,
    followSymbolicLinks: false,
  });
  // Defense in depth: reject any resolved path that escapes the config
  // directory (e.g. via `..` segments in the glob input).
  const escaped = matched.filter((p) => path.relative(configDir, p).startsWith(".."));
  if (escaped.length > 0) {
    throw createScaiError(
      `Recipe glob resolved to ${escaped.length} path(s) outside the config directory: ${escaped.slice(0, 3).join(", ")}${escaped.length > 3 ? `, +${escaped.length - 3} more` : ""}.`,
      "INPUT_INVALID",
      {
        hint: "Recipe paths must live under the directory containing sitecoreai.cli.json.",
      }
    );
  }
  if (matched.length === 0) {
    throw createScaiError(
      `No recipe files matched the config glob: ${root.recipes.join(", ")}.`,
      "INPUT_INVALID",
      {
        hint: "Pass --input <recipe-file>, or update the `recipes` glob in sitecoreai.cli.json.",
      }
    );
  }
  return { files: matched.sort(), source: "config-glob" };
};

// Re-exported from the shared gate so `recipe push` goes through the
// same workspace-policy enforcement (ceiling, caller context, the
// `recipe-push` destructive tier) as every other write path. The
// recipe-local copy that used to live here predated the policy layer.
export { ensureAllowWrite } from "@/policy/allow-write";

/**
 * Load the image-defaults map (role → external URL) for a compile/push.
 * Resolution: `--image-defaults <path>` flag → `SITECOREAI_IMAGE_DEFAULTS`
 * env var (also a path) → undefined (recipe defaults apply unchanged).
 *
 * The file must be a flat JSON object of string → string; values must be
 * fully-qualified http(s) URLs (the compiler re-validates per role at the
 * substitution site, but failing fast here surfaces a broken map before
 * any tenant work starts).
 */
export const loadImageDefaults = async (
  imageDefaultsPath: string | undefined
): Promise<Record<string, string> | undefined> => {
  const resolved = imageDefaultsPath ?? process.env.SITECOREAI_IMAGE_DEFAULTS?.trim();
  if (!resolved) return undefined;
  const fs = await import("node:fs/promises");
  let rawText: string;
  try {
    rawText = await fs.readFile(path.resolve(resolved), "utf8");
  } catch (error) {
    throw createScaiError(
      `Failed to read image-defaults file '${resolved}': ${error instanceof Error ? error.message : String(error)}`,
      "INPUT_INVALID",
      { hint: "Pass --image-defaults <path> to a readable JSON file of role → URL." }
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw createScaiError(`Image-defaults file '${resolved}' is not valid JSON.`, "INPUT_INVALID", {
      hint: 'Expected a flat object like {"hero": "https://…", "avatar": "https://…"}.',
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createScaiError(
      `Image-defaults file '${resolved}' must be a flat JSON object of role → URL.`,
      "INPUT_INVALID"
    );
  }
  const map: Record<string, string> = {};
  for (const [role, url] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw createScaiError(
        `Image-defaults entry '${role}' must be a fully-qualified http(s) URL (got ${JSON.stringify(url)}).`,
        "INPUT_INVALID"
      );
    }
    map[role] = url;
  }
  return Object.keys(map).length > 0 ? map : undefined;
};
