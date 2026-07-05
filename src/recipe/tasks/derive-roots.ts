import type { EnvironmentRecipeRoots } from "@/config/types";
import { createScaiError } from "@/shared/errors";

/**
 * Derive the full set of recipe parent paths for an SXA Headless site from
 * just its `site` (site name) and `siteCollection` (parent tenant).
 *
 * Recipe authoring normally requires ~13 `recipeRoots` paths to be spelled
 * out by hand in `sitecoreai.cli.json`. They are, however, a pure function of
 * two values plus the fixed SXA Headless tree layout — every site-related root
 * is scoped under `<siteCollection>/<siteName>` so two sites under one project
 * never collide on shared template / rendering names:
 *
 *   templates / components → /sitecore/templates/Project/<collection>/<site>/Components
 *   content models         → /sitecore/templates/Project/<collection>/<site>/Content Models
 *   page templates         → /sitecore/templates/Project/<collection>/<site>/Pages
 *   renderings             → /sitecore/layout/Renderings/Project/<collection>/<site>/Components
 *   partial designs        → /sitecore/content/<collection>/<site>/Presentation/Partial Designs
 *   page designs           → /sitecore/content/<collection>/<site>/Presentation/Page Designs
 *   content items          → /sitecore/content/<collection>/<site>/Data
 *   headless variants      → /sitecore/content/<collection>/<site>/Presentation/Headless Variants
 *   available renderings   → /sitecore/content/<collection>/<site>/Presentation/Available Renderings
 *   presentation styles    → /sitecore/content/<collection>/<site>/Presentation/Styles
 *   enumerations           → /sitecore/content/<collection>/<site>/Presentation/Enumerations
 *   placeholder settings   → per-site `<content>/Presentation/Placeholder Settings`
 *                            + project-level `/sitecore/layout/Placeholder Settings/Project/<collection>/<site>`
 *
 * This is a faithful port of the orchestrator's proven `buildRecipeRoots`
 * (`packages/scai-shared/src/execution/ephemeral-cli-config.ts`) — the
 * derivation a hosted install has used all along. Lifting it here lets a
 * standalone repo set a single `site` value instead of authoring every path,
 * while producing byte-identical results.
 *
 * Derivation is the *fallback*: explicit `recipeRoots` / `*Root` config and
 * CLI-flag overrides still win at resolution time (see
 * `plans/recipe-roots-derivation.md`). `pages` is intentionally not
 * derived — it is set explicitly when a tenant needs it, matching the
 * orchestrator's behaviour. `pageTemplates` derives to
 * `<projectTemplates>/Pages` (its own bucket, sibling of Components /
 * Content Models) — earlier it wasn't derived and fell back to the
 * Components bucket, which mixed page templates in with component
 * datasource templates.
 */
export const deriveRecipeRoots = (site: string, siteCollection: string): EnvironmentRecipeRoots => {
  const trimmedSite = site.trim();
  const trimmedCollection = siteCollection.trim();
  if (trimmedSite.length === 0 || trimmedCollection.length === 0) {
    throw createScaiError(
      "Cannot derive recipe roots without both a site name and a site collection.",
      "INPUT_INVALID",
      {
        hint: "Set `site` (and, when it can't be discovered, `siteCollection`) on the env profile, or provide explicit recipeRoots.",
      }
    );
  }

  const projectTemplates = `/sitecore/templates/Project/${trimmedCollection}/${trimmedSite}`;
  const projectRenderings = `/sitecore/layout/Renderings/Project/${trimmedCollection}/${trimmedSite}`;
  const projectPlaceholderSettings = `/sitecore/layout/Placeholder Settings/Project/${trimmedCollection}/${trimmedSite}`;
  const siteContentRoot = `/sitecore/content/${trimmedCollection}/${trimmedSite}`;

  return {
    templates: `${projectTemplates}/Components`,
    components: `${projectTemplates}/Components`,
    contentModels: `${projectTemplates}/Content Models`,
    // Page templates get their own bucket, sibling of Components /
    // Content Models. Without this the compiler's fallback dumped them
    // into `<templates>` — i.e. the Components bucket — mixing page
    // templates in with component datasource templates.
    pageTemplates: `${projectTemplates}/Pages`,
    renderings: `${projectRenderings}/Components`,
    partialDesigns: `${siteContentRoot}/Presentation/Partial Designs`,
    pageDesigns: `${siteContentRoot}/Presentation/Page Designs`,
    contentItems: `${siteContentRoot}/Data`,
    mediaLibrary: `/sitecore/media library/Project/${trimmedCollection}/${trimmedSite}`,
    headlessVariants: `${siteContentRoot}/Presentation/Headless Variants`,
    availableRenderings: `${siteContentRoot}/Presentation/Available Renderings`,
    presentationStyles: `${siteContentRoot}/Presentation/Styles`,
    enumerations: `${siteContentRoot}/Presentation/Enumerations`,
    placeholderSettings: [
      `${siteContentRoot}/Presentation/Placeholder Settings`,
      projectPlaceholderSettings,
    ],
    // Singular CREATE root for recipe-declared placeholder settings — the
    // per-site path (first walk entry). Distinct from the walk list above.
    placeholderSettingsCreate: `${siteContentRoot}/Presentation/Placeholder Settings`,
  };
};
