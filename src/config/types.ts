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
  pageTemplates?: string;
  pages?: string;
  contentItems?: string;
  headlessVariants?: string;
  availableRenderings?: string;
  presentationStyles?: string;
  enumerations?: string;
  /** Walk roots for resolving `placedIn` against pre-existing placeholders. */
  placeholderSettings?: string[];
  /** Create root for recipe-defined Placeholder Settings items. */
  placeholderSettingsCreate?: string;
};

/**
 * Non-secret metadata for a scai-minted automation client. Per
 * `docs/credentials.md` the config file is a readable inventory of every
 * configured credential: it carries the client's `clientId`, display
 * `name`, and `mintedAt` timestamp. Only the client **secret** lives in
 * the OS keychain — never here. Used both for the env-scoped client (the
 * `automationClient` block on an env profile) and the org-scoped client
 * (an `orgClients[orgId]` entry).
 */
export type AutomationClientMetadata = {
  /** OAuth client id of the scai-minted automation client. */
  clientId: string;
  /** Display name of the client in the Cloud Portal (the `scai-*` name). */
  name?: string;
  /** ISO timestamp the client was minted. */
  mintedAt?: string;
};

/**
 * A named environment profile.
 *
 * Per `docs/credentials.md` an env profile carries **environment
 * identity only** — `organizationId` / `projectId` / `environmentId` /
 * `host` / `authority` / `audience` / `environmentType` — plus the
 * **non-secret metadata** of the credentials configured for it. It does
 * **not** carry credential secrets: the automation client is minted by
 * `scai setup client create` and only its secret is stored in the OS
 * keychain; its non-secret parts (`clientId` / `name` / `mintedAt`) live
 * in the `automationClient` block here. The brand key is registered into
 * the separate `brand[orgId]` block.
 *
 * `clientId` + `useClientCredentials` remain **only** as the documented
 * bring-your-own-client escape hatch (the operator supplies their own
 * automation client; its secret comes from
 * `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`, resolved at the auth layer and
 * never stored here). `accessToken` / `refreshToken` / `deployToken` are
 * token-cache metadata, not credentials — the CLI writes tokens to the
 * keychain and only reads these legacy fields for back-compat with
 * configs written by earlier versions. `deployTokenExpiresIn` /
 * `deployTokenLastUpdated` record the cached deploy token's freshness so
 * the auto-wizard can decide whether a re-login is due.
 */
export type EnvironmentConfiguration = {
  name?: string;
  host?: string;
  authority?: string;
  environmentType?: "cm" | "eh";
  allowWrite?: boolean;
  /**
   * When `true`, MCP write tools refuse to operate against this
   * environment even when the host has cleared their own
   * write-confirmation UX. Use for production-shaped environments
   * where every destructive op must originate from a human-driven CLI
   * call (`--allow-write`) and never from an MCP-elevated context. The
   * gate fires at the MCP tool boundary — direct CLI use is
   * unaffected.
   *
   * Defaults to `false` (MCP elevation allowed).
   */
  denyMcpElevation?: boolean;
  /** @deprecated Token-cache metadata. Tokens live in the OS keychain; read for back-compat only. */
  accessToken?: string;
  /** @deprecated Token-cache metadata. Tokens live in the OS keychain; read for back-compat only. */
  refreshToken?: string;
  /** @deprecated Token-cache metadata. Tokens live in the OS keychain; read for back-compat only. */
  refreshTokenParameters?: Record<string, string>;
  /** @deprecated Token-cache metadata. Tokens live in the OS keychain; read for back-compat only. */
  expiresIn?: number | null;
  /** @deprecated Token-cache metadata. Tokens live in the OS keychain; read for back-compat only. */
  lastUpdated?: string | null;
  /** @deprecated Token-cache metadata. The deploy token lives in the OS keychain; read for back-compat only. */
  deployToken?: string;
  /**
   * `expires_in` (seconds) of the cached deploy token. Freshness
   * metadata — not a credential — recorded so the auto-wizard's expiry
   * check can decide whether a re-login is due. Paired with
   * `deployTokenLastUpdated`. The token string itself lives in the OS
   * keychain (`deploy:<env>` slot).
   */
  deployTokenExpiresIn?: number | null;
  /**
   * ISO timestamp of the last deploy-token mint. Paired with
   * `deployTokenExpiresIn`; see that field.
   */
  deployTokenLastUpdated?: string | null;
  editingHostEnvironmentIds?: string[];
  organizationId?: string;
  tenantId?: string;
  projectId?: string;
  environmentId?: string;
  /**
   * Bring-your-own-client escape hatch: the OAuth client id of an
   * automation client the operator supplies themselves, instead of
   * letting `scai setup client create` mint one. Pair with
   * `useClientCredentials: true`; the matching secret comes from the
   * `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` environment variable, resolved
   * at the auth layer — it is never stored on the env profile.
   */
  clientId?: string;
  /**
   * Bring-your-own-client escape hatch toggle: when `true`, scai uses
   * the operator-supplied `clientId` + `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`
   * client-credentials grant instead of an interactive device login.
   */
  useClientCredentials?: boolean;
  /**
   * Non-secret metadata of the **env-scoped** automation client scai
   * minted for this environment via `scai setup client create <env>`.
   * Per `docs/credentials.md` the config file is the readable inventory
   * of configured credentials: this records the minted client's
   * `clientId`, `name`, and `mintedAt`. The matching **secret** lives in
   * the OS keychain (`cm-client:<env>` slot) — never here.
   *
   * Distinct from the bring-your-own-client `clientId` /
   * `useClientCredentials` pair above: that hatch is for an operator-
   * supplied client; `automationClient` is for the one scai itself
   * mints.
   */
  automationClient?: AutomationClientMetadata;
  variables?: Record<string, string>;
  audience?: string;
  ref?: string;
  cacheAuthenticationToken?: boolean;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push` creates
   * template items. Tenant-specific because each site has its own
   * `/sitecore/templates/Project/<site>/Components` location.
   *
   * Used as fallback when the CLI flag `--templates-root` is not passed.
   */
  templatesRoot?: string;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push` creates
   * rendering items. Tenant-specific.
   *
   * Used as fallback when the CLI flag `--renderings-root` is not passed.
   */
  renderingsRoot?: string;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push` creates
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
   * Sitecore parent path under which `scai provision recipe compile|push` creates
   * content-template items
   * (`<contentModelsRoot>/<group>/<name>` when grouped, flat otherwise).
   * When unset, content templates fall back to `templatesRoot` — which
   * means they land mixed in with components, not separated.
   *
   * Used as fallback when the CLI flag `--content-models-root` is not passed.
   */
  contentModelsRoot?: string;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push` creates
   * partial-design items (Phase 4). Typically
   * `/sitecore/content/<site>/Presentation/Partial Designs`.
   *
   * Optional — only `PartialDesignRecipe` compilation requires it.
   */
  partialDesignsRoot?: string;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push` creates
   * page-design items (Phase 4). Typically
   * `/sitecore/content/<site>/Presentation/Page Designs`.
   *
   * Optional — only `PageDesignRecipe` compilation requires it. Also
   * used by `runRecipePush` to seed `crossRecipeRefs` so the cross-
   * recipe `TemplatesMapping` aggregate op can resolve its target.
   */
  pageDesignsRoot?: string;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push` creates
   * shared content items (Phase 4). Typically
   * `/sitecore/content/<site>/Data` or a sub-bucket.
   *
   * Optional — only `ContentItemRecipe` compilation requires it.
   */
  contentItemsRoot?: string;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push` creates
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
   * Sitecore parent path under which `scai provision recipe compile|push` creates
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
   * Sitecore parent path for the per-site SXA Headless `Styles` bucket —
   * typically `/sitecore/content/<siteCollection>/<site>/Presentation/Styles`.
   *
   * Currently only consumed by `scai provision recipe prune-defaults`,
   * which removes the OOTB style buckets (Spacing, Add Highlight, etc.)
   * SXA seeds here. Recipe authoring does not write to this root today.
   */
  presentationStylesRoot?: string;
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
   * Sitecore parent path under which `scai provision recipe compile|push`
   * CREATES recipe-defined Placeholder Settings items — one per unique
   * placeholder key from a `PlaceholderRecipe` or an inline
   * `ComponentTemplateRecipe.placeholders` slot. Typically
   * `/sitecore/content/<site>/Presentation/Placeholder Settings`.
   *
   * Distinct from `placeholderSettingsRoots` (plural) above: that list
   * is WALKED at apply time to find PRE-EXISTING tenant placeholders for
   * `placedIn` allow-control patching; this single path is where the
   * compiler MATERIALISES recipe-owned placeholders. Operators usually
   * set this to a path inside one of the walk roots.
   *
   * Required when the recipe set declares any placeholder; the compiler
   * throws INPUT_INVALID with a hint when needed but missing.
   */
  placeholderSettingsRoot?: string;
  /**
   * Sitecore parent path under which `scai provision recipe compile|push`
   * creates `PageTemplateRecipe` items — typically
   * `/sitecore/templates/Project/<site>`. Optional; falls back to
   * `templatesRoot` when unset.
   */
  pageTemplatesRoot?: string;
  /**
   * Sitecore content-tree root under which `scai provision recipe
   * compile|push` creates `PageRecipe` items — typically
   * `/sitecore/content/<tenant>/<site>/Home`. Optional; only
   * `PageRecipe` compilation requires it.
   */
  pagesRoot?: string;
  /**
   * Preferred nested form of the `*Root` fields above. When set,
   * `readRootConfiguration` flattens entries into the matching flat
   * fields before internal consumers read them. New configs should
   * use this shape — it scales as new recipe-tree roots get added
   * without bloating each env profile.
   */
  recipeRoots?: EnvironmentRecipeRoots;
  /**
   * Production-tier marker. Read by `scai content publish` to decide between
   * the simple `[y/N]` confirmation path and the two-step typed-scope-
   * token flow. Auto-flags `true` when the env name matches `/prod/i`
   * or `/^live/i`; set explicitly to `false` to override the heuristic
   * (e.g. an env named `prod-test` that isn't really production).
   */
  production?: boolean;
  /**
   * Permits `scai content publish all` (whole-tenant republish) from CI on
   * this env. Default is human-only. Only honored when `production`
   * is true; otherwise has no effect.
   */
  allowFullRepublish?: boolean;
  /**
   * CI pipeline identifiers allowed to run `scai content publish` against
   * this env. The CLI/library compares the runtime principal's
   * pipeline ID against this list; an empty/unset list means
   * human-only.
   */
  allowedCiPipelines?: string[];
};

/**
 * Brand credential record, keyed by Sitecore organization ID — the
 * credential `scai brand` (Brand Management, Review, Documents,
 * Pipeline) authenticates with.
 *
 * Backed by a Sitecore "AI APIs key" created in Cloud Portal → Stream
 * → Admin → AI APIs keys: bound to a single org (confirmed
 * one-org-per-credential), carrying its own scope set (`ai.org.brd:r/w`,
 * `ai.org.docs:r/w`, `ai.orgs.br:gen`). It is one of scai's two
 * credential kinds — distinct from the automation client (the deploy /
 * cm clients minted by `scai setup client create`); the automation
 * client cannot do brand work and vice versa. **Not minted by scai** —
 * the operator creates the AI APIs key in Cloud Portal and registers it
 * with `scai setup client register-brand`. The `clientSecret` is never
 * stored on disk — it lives only in the OS keychain. Token cache
 * timings here are advisory; the cached access token is also in the
 * keychain.
 */
export type BrandCredential = {
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
  /** Brand credentials, keyed by Sitecore `organizationId`. */
  brand: Record<string, BrandCredential>;
  /**
   * Non-secret metadata of the scai-minted **org-scoped** automation
   * clients, keyed by Sitecore `organizationId`. One per org, shared by
   * every env profile in it. The matching secret lives in the OS
   * keychain (`org-client:<orgId>` slot) — never here.
   */
  orgClients: Record<string, AutomationClientMetadata>;
  physicalPath: string;
  /**
   * Active environment name: the configured `defaultEnvProfile`, or the
   * literal `"default"` when none is set. Use `defaultEnvProfile` (raw,
   * `undefined` when unset) to tell a real default apart from the
   * fallback — the `"default"` placeholder is not a real env profile.
   */
  defaultEnvironment: string;
  /** The raw `defaultEnvProfile` from the config file; `undefined` when unset. */
  defaultEnvProfile?: string;
  /**
   * Globs (relative to the project root) that locate `.recipe.ts` /
   * `.recipe.json` files for `scai provision recipe compile|plan|push`. When the
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
   * Brand credentials, keyed by Sitecore `organizationId`. Stored
   * separately from `envProfiles` because the AI APIs key is org-scoped,
   * not env-scoped — multiple env profiles in the same org share one
   * credential.
   */
  brand?: Record<string, BrandCredential>;
  /**
   * @deprecated Legacy name for `brand` (the block was called `aiSkills`
   * before the rename). Read for back-compat with configs written by
   * older CLI versions; the CLI always writes `brand` going forward.
   */
  aiSkills?: Record<string, BrandCredential>;
  /**
   * Non-secret metadata of the scai-minted **org-scoped** automation
   * clients, keyed by Sitecore `organizationId`. Stored separately from
   * `envProfiles` because the org client is org-scoped, not env-scoped —
   * every env profile in the same org shares one. The matching secret
   * lives in the OS keychain (`org-client:<orgId>` slot), never here.
   */
  orgClients?: Record<string, AutomationClientMetadata>;
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
  telemetryEnabled: true,
  cacheAuthenticationToken: true,
  versionComparisonEnabled: true,
  apiClientTimeoutInMinutes: 5,
};

export const DEFAULT_ENVIRONMENT = "default";

export const DEFAULT_RECIPES_GLOBS: string[] = ["recipes/**/*.recipe.ts"];
