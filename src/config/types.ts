import type { FilesystemTreeSpec } from "../serialization/tree-spec";
import type { FieldFilter, RolePredicateItem, UserPredicateItem } from "../serialization/types";

export type SerializationRootConfiguration = {
  defaultMaxRelativeItemPathLength: number;
  defaultModuleRelativeSerializationPath: string;
  removeOrphansForRoles: boolean;
  removeOrphansForUsers: boolean;
  continueOnItemFailure: boolean;
  excludedFields: FieldFilter[];
};

export type Settings = {
  telemetryEnabled: boolean;
  cacheAuthenticationToken: boolean;
  versionComparisonEnabled: boolean;
  apiClientTimeoutInMinutes: number;
};

/**
 * Nested form of the recipe parent paths for a single env profile.
 * Authors may set these under `envProfiles.<name>.recipeRoots` instead
 * of (or in addition to) the flat `templatesRoot` / `renderingsRoot` /
 * etc. fields. At config-load time `readRootConfiguration` flattens
 * the nested form into the flat fields so internal consumers see one
 * shape.
 *
 * If the same field is set both nested and flat, **nested wins** —
 * `recipeRoots` is the preferred form for new configs. A duplication
 * warning fires so the operator can pick a side.
 */
export type EnvironmentRecipeRoots = {
  templates?: string;
  renderings?: string;
  components?: string;
  contentModels?: string;
  partialDesigns?: string;
  pageDesigns?: string;
  contentItems?: string;
  headlessVariants?: string;
  availableRenderings?: string;
  enumerations?: string;
  placeholderSettings?: string[];
};

export type EnvironmentConfiguration = {
  name?: string;
  host?: string;
  authority?: string;
  environmentType?: "cm" | "eh";
  allowWrite?: boolean;
  accessToken?: string;
  refreshToken?: string;
  refreshTokenParameters?: Record<string, string>;
  expiresIn?: number | null;
  lastUpdated?: string | null;
  deployToken?: string;
  deployTokenExpiresIn?: number | null;
  deployTokenLastUpdated?: string | null;
  editingHostEnvironmentIds?: string[];
  organizationId?: string;
  tenantId?: string;
  projectId?: string;
  environmentId?: string;
  clientId?: string;
  clientSecret?: string;
  useClientCredentials?: boolean;
  variables?: Record<string, string>;
  audience?: string;
  ref?: string;
  cacheAuthenticationToken?: boolean;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * template items. Tenant-specific because each site has its own
   * `/sitecore/templates/Project/<site>/Components` location.
   *
   * Used as fallback when the CLI flag `--templates-root` is not passed.
   */
  templatesRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * rendering items. Tenant-specific.
   *
   * Used as fallback when the CLI flag `--renderings-root` is not passed.
   */
  renderingsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * component template items in the per-site folder layout
   * (`<componentsRoot>/<section>/<Component>`). When unset, the compiler
   * falls back to `templatesRoot` and emits the legacy flat layout.
   * Typically the same path as `templatesRoot` but kept distinct so
   * future per-site nesting (`Project/<site>/Components`) doesn't
   * conflate with the legacy fallback.
   *
   * Used as fallback when the CLI flag `--components-root` is not passed.
   */
  componentsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * content-template items
   * (`<contentModelsRoot>/<group>/<name>` when grouped, flat otherwise).
   * When unset, content templates fall back to `templatesRoot` — which
   * means they land mixed in with components, not separated.
   *
   * Used as fallback when the CLI flag `--content-models-root` is not passed.
   */
  contentModelsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * partial-design items (Phase 4). Typically
   * `/sitecore/content/<site>/Presentation/Partial Designs`.
   *
   * Optional — only `PartialDesignRecipe` compilation requires it.
   */
  partialDesignsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * page-design items (Phase 4). Typically
   * `/sitecore/content/<site>/Presentation/Page Designs`.
   *
   * Optional — only `PageDesignRecipe` compilation requires it. Also
   * used by `runRecipePush` to seed `crossRecipeRefs` so the cross-
   * recipe `TemplatesMapping` aggregate op can resolve its target.
   */
  pageDesignsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * shared content items (Phase 4). Typically
   * `/sitecore/content/<site>/Data` or a sub-bucket.
   *
   * Optional — only `ContentItemRecipe` compilation requires it.
   */
  contentItemsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * SXA Headless rendering variants. Typically
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants`.
   *
   * Variants for a recipe `R` with section `S` and N variants land at
   * `<headlessVariantsRoot>/<S>/<R.name>/<variant>` and conform to the
   * SXA `Variant Definition` template; the section + per-rendering
   * groupings use `HeadlessVariantsGrouping` / `HeadlessVariants`
   * respectively (`SITECORE_TEMPLATES.HEADLESS_VARIANTS_*`).
   *
   * Required for any recipe that declares `variants` — without it the
   * compiler throws INPUT_INVALID before emitting variant ops, since
   * the legacy "variants live under the rendering item" layout no
   * longer matches SXA Headless.
   */
  headlessVariantsRoot?: string;
  /**
   * Sitecore parent path under which `scai recipe compile|push` creates
   * SXA `Available Renderings` section items. Typically
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Available Renderings`.
   *
   * `compileRecipeSet` aggregates every component-template recipe by
   * `section` and emits one `Available Renderings` child per section,
   * setting the `Renderings` field to the pipe-separated rendering
   * itemIds. SXA's editor reads this list when composing pages.
   *
   * Optional — when unset, the compileRecipeSet aggregator skips the
   * Available Renderings emission entirely. Pushing without it leaves
   * the rendering list unscoped (the SXA editor falls back to the
   * tenant-wide list, which usually isn't what you want).
   */
  availableRenderingsRoot?: string;
  /**
   * Per-site enumerations bucket — typically
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Enumerations`.
   * Each `EnumerationRecipe` lands as `<enumerationsRoot>/<EnumName>`
   * with one child item per declared value. Required for
   * `EnumerationRecipe` compilation, AND for any recipe whose fields
   * carry `sitecore.enumHandle` (the Droplink Source paths into this
   * bucket).
   */
  enumerationsRoot?: string;
  /**
   * Sitecore content-tree paths to walk when resolving recipe-declared
   * `placeholders` to actual Placeholder Settings items (matched by
   * the items' `Placeholder Key` field). Both per-site
   * `<site>/Presentation/Placeholder Settings` and project-level
   * `/sitecore/Layout/Placeholder Settings/Project/<site>` typically
   * need to be searched.
   *
   * Empty / unset → recipe `placeholders` declarations are silently
   * ignored. The orchestrator's ephemeral CLI config sets this; not
   * commonly hand-authored.
   */
  placeholderSettingsRoots?: string[];
  /**
   * Preferred nested form of the 11 `*Root` fields above. When set,
   * `readRootConfiguration` flattens entries into the matching flat
   * fields before internal consumers read them. New configs should
   * use this shape — it scales as new recipe-tree roots get added
   * without bloating each env profile.
   */
  recipeRoots?: EnvironmentRecipeRoots;
  /**
   * Production-tier marker. Read by `scai publish` to decide between
   * the simple `[y/N]` confirmation path and the two-step typed-scope-
   * token flow. Auto-flags `true` when the env name matches `/prod/i`
   * or `/^live/i`; set explicitly to `false` to override the heuristic
   * (e.g. an env named `prod-test` that isn't really production).
   */
  production?: boolean;
  /**
   * Permits `scai publish all` (whole-tenant republish) from CI on
   * this env. Default is human-only. Only honored when `production`
   * is true; otherwise has no effect.
   */
  allowFullRepublish?: boolean;
  /**
   * CI pipeline identifiers allowed to run `scai publish` against
   * this env. The CLI/library compares the runtime principal's
   * pipeline ID against this list; an empty/unset list means
   * human-only.
   */
  allowedCiPipelines?: string[];
};

/**
 * AI Skills credential record, keyed by Sitecore organization ID.
 *
 * AI APIs keys are created in Cloud Portal → Stream → Admin → AI APIs
 * keys, are bound to a single org (confirmed one-org-per-credential),
 * and carry their own scope set (`ai.org.brd:r/w`, `ai.org.docs:r/w`,
 * `ai.orgs.br:gen`). They are NOT the env-level automation client
 * `scai login` provisions for Pages/Sites/Authoring. The
 * `clientSecret` is never stored on disk — it lives only in the OS
 * keychain. Token cache timings here are advisory; the actual cached
 * access token is also in the keychain.
 */
export type AiSkillsCredential = {
  clientId: string;
  audience?: string;
  authority?: string;
  tokenExpiresIn?: number | null;
  tokenLastUpdated?: string | null;
};

export type RootConfiguration = {
  modules: string[];
  serialization: SerializationRootConfiguration;
  settings: Settings;
  environments: Record<string, EnvironmentConfiguration>;
  /** AI Skills credentials, keyed by Sitecore `organizationId`. */
  aiSkills: Record<string, AiSkillsCredential>;
  physicalPath: string;
  defaultEnvironment: string;
  /**
   * Globs (relative to the project root) that locate `.recipe.ts` /
   * `.recipe.json` files for `scai recipe compile|plan|push`. When the
   * commands run without `--input`, they fall back to this glob set.
   * Defaults to `["recipes/**\/*.recipe.ts"]` if unset.
   */
  recipes: string[];
};

export type RootConfigurationFile = {
  $schema?: string;
  modules?: string[];
  serialization?: Partial<SerializationRootConfiguration>;
  settings?: Partial<Settings>;
  envProfiles?: Record<string, EnvironmentConfiguration>;
  defaultEnvProfile?: string;
  /**
   * AI Skills credentials, keyed by Sitecore `organizationId`. Stored
   * separately from `envProfiles` because the AI APIs key is org-scoped,
   * not env-scoped — multiple env profiles in the same org share one
   * credential.
   */
  aiSkills?: Record<string, AiSkillsCredential>;
  /** Globs locating recipe files. See `RootConfiguration.recipes`. */
  recipes?: string[];
  [key: string]: unknown;
};

export type UserConfiguration = {
  envProfiles?: Record<string, EnvironmentConfiguration>;
  defaultEnvProfile?: string;
};

export type SerializationModuleConfigurationItems = {
  path?: string;
  includes: FilesystemTreeSpec[];
  excludedFields: FieldFilter[];
};

export type SerializationModuleConfiguration = {
  namespace: string;
  description?: string;
  references: string[];
  items: SerializationModuleConfigurationItems;
  roles: RolePredicateItem[];
  users: UserPredicateItem[];
  tags: string[];
  sourceIdentifier: string;
};

export const DEFAULT_SERIALIZATION: SerializationRootConfiguration = {
  defaultMaxRelativeItemPathLength: 120,
  defaultModuleRelativeSerializationPath: "serialization",
  removeOrphansForRoles: true,
  removeOrphansForUsers: true,
  continueOnItemFailure: false,
  excludedFields: [],
};

export const DEFAULT_SETTINGS: Settings = {
  telemetryEnabled: false,
  cacheAuthenticationToken: true,
  versionComparisonEnabled: true,
  apiClientTimeoutInMinutes: 5,
};

export const DEFAULT_ENVIRONMENT = "default";

export const DEFAULT_RECIPES_GLOBS: string[] = ["recipes/**/*.recipe.ts"];
