import type {
  ComponentTemplateRecipe,
  ContentItemRecipe,
  ContentTemplateRecipe,
  PageDesignRecipe,
  PartialDesignRecipe,
  Recipe,
} from "../../../../../src/recipe/schema/recipe";

/**
 * Phase 4 milestone F.2.a — complete sandbox-pushable recipe set.
 *
 * Used by `composition.integration.test.ts` to push a coherent recipe set
 * to the sandbox tenant and verify partial-design / page-design wiring
 * end-to-end. The set is intentionally close to a real registry catalog:
 * 10 component templates, 4 data-only content templates, 3 page templates,
 * 9 shared content items, 3 partial designs, 3 page designs. Twenty-seven
 * recipes total, with cross-recipe references covering:
 *
 *   - `componentHandle` in partial / page-design layouts
 *   - `templateType` on content items
 *   - `appliesTo` on page designs (page templates)
 *   - `partials` on page designs (partial designs)
 *   - `datasourceRef.kind: "shared"` on placements (content items)
 *   - `reference` field shape on content items (multi-handle nav lists)
 *
 * Per-run uniqueness — every handle suffixes `-${runId}@1` so concurrent
 * runs don't collide on the tenant. The internal references stay
 * symbolic (`siteLogo`, `homePage`, …) and resolve to runId-aware handles
 * via the `h(...)` helper. Cleanup deletes by path; itemId capture isn't
 * needed for teardown.
 *
 * Field-shape constraint: `link-internal` is deferred to Phase 5
 * (`compileContentItemRecipe` throws), so content items use only
 * `text` / `richText` / `image` / `link-external` / `reference` shapes.
 */

export interface Phase4FixtureSet {
  recipes: Recipe[];
  /** Helper that resolves a symbolic key to its runId-suffixed handle. */
  handle: (key: string) => string;
  /** Display-friendly per-recipe `name` (Sitecore item name) used for path lookups. */
  name: (key: string) => string;
}

const SYMBOLIC_KEYS = [
  // page templates (3)
  "homePage",
  "landingPage",
  "articlePage",
  // shared data templates (4)
  "textBlockTpl",
  "navListTpl",
  "navLinkTpl",
  "footerSocialTpl",
  // component templates (10)
  "siteLogo",
  "primaryNav",
  "utilityNav",
  "ctaBanner",
  "authorAvatar",
  "authorInfo",
  "readTime",
  "footerLinkGrid",
  "footerSocial",
  "footerCopyright",
  // content items (9)
  "siteLogoContent",
  "primaryNavContent",
  "utilityNavContent",
  "navLinkProducts",
  "navLinkPricing",
  "navLinkDocs",
  "footerGridContent",
  "footerSocialContent",
  "footerCopyrightContent",
  "bylineAuthorContent",
  "landingCtaContent",
  // partial designs (3)
  "standardHeader",
  "standardFooter",
  "articleByline",
  // page designs (3)
  "defaultPageDesign",
  "landingPageDesign",
  "articlePageDesign",
] as const;

type SymbolicKey = (typeof SYMBOLIC_KEYS)[number];

/**
 * Convert a symbolic key (e.g. `siteLogo`) to its kebab-case prefix
 * (`site-logo`). Used to keep the per-runId handles readable.
 */
const toKebab = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Build a complete recipe set for the given run identifier. Idempotent —
 * called twice with the same `runId` returns recipes whose handles match
 * byte-for-byte (drives the second-push idempotency assertion).
 */
export function buildPhase4Fixtures(runId: string): Phase4FixtureSet {
  // The handle vocabulary is closed; expose lookup helpers that throw on
  // typos (e.g. handle("primary-nav") instead of handle("primaryNav")).
  const handles = new Map<string, string>();
  const names = new Map<string, string>();
  for (const key of SYMBOLIC_KEYS) {
    handles.set(key, `${toKebab(key)}-p4-${runId}@1`);
    // Sitecore item names: PascalCase + runId (no hyphens). Keeps paths
    // short and avoids characters Sitecore name-validates against.
    names.set(
      key,
      `${key.charAt(0).toUpperCase()}${key.slice(1)}P4${runId.replace(/[^a-z0-9]/gi, "")}`
    );
  }

  const handle = (key: string): string => {
    const value = handles.get(key);
    if (!value) throw new Error(`Unknown symbolic key: ${key}`);
    return value;
  };
  const name = (key: string): string => {
    const value = names.get(key);
    if (!value) throw new Error(`Unknown symbolic key: ${key}`);
    return value;
  };

  const h = handle as (key: SymbolicKey) => string;
  const n = name as (key: SymbolicKey) => string;

  // ---------------- content templates ----------------
  // Page templates: data-only, no fields. Real Sitecore pages would inherit
  // from the SXA `_Page` chain; for sandbox composition validation we just
  // need GUIDs that page designs can map to via `appliesTo`.
  const homePageTpl: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: h("homePage"),
    name: n("homePage"),
    displayName: `Home Page (${runId})`,
    description: "Phase-4 sandbox fixture: home page template.",
    fields: [],
  };
  const landingPageTpl: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: h("landingPage"),
    name: n("landingPage"),
    displayName: `Landing Page (${runId})`,
    description: "Phase-4 sandbox fixture: landing page template.",
    fields: [],
  };
  const articlePageTpl: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: h("articlePage"),
    name: n("articlePage"),
    displayName: `Article Page (${runId})`,
    description: "Phase-4 sandbox fixture: article page template.",
    fields: [],
  };

  // Generic single-text-block content shape. Used by site-logo, footer-grid,
  // footer-copyright, byline-author, landing-cta, footer-social — every
  // content item that just stores a Title + Body pair.
  const textBlockTpl: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: h("textBlockTpl"),
    name: n("textBlockTpl"),
    displayName: `Text Block Template (${runId})`,
    fields: [
      { name: "Title", shape: "text" },
      { name: "Body", shape: "richText" },
    ],
  };

  // Nav-list shape: holds an ordered list of references to other content
  // items. Used by primary-nav and utility-nav.
  const navListTpl: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: h("navListTpl"),
    name: n("navListTpl"),
    displayName: `Nav List Template (${runId})`,
    fields: [
      { name: "Label", shape: "text" },
      { name: "Items", shape: "reference", multiple: true },
    ],
  };

  // Single nav-link shape — Label + external URL (link-internal deferred).
  const navLinkTpl: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: h("navLinkTpl"),
    name: n("navLinkTpl"),
    displayName: `Nav Link Template (${runId})`,
    fields: [
      { name: "Label", shape: "text" },
      { name: "Url", shape: "link" },
    ],
  };

  // Footer-social shape: three external-link fields (one per network).
  const footerSocialTpl: ContentTemplateRecipe = {
    kind: "content-template",
    schemaVersion: "1",
    handle: h("footerSocialTpl"),
    name: n("footerSocialTpl"),
    displayName: `Footer Social Template (${runId})`,
    fields: [
      { name: "X", shape: "link" },
      { name: "LinkedIn", shape: "link" },
      { name: "GitHub", shape: "link" },
    ],
  };

  // ---------------- component templates (10) ----------------
  // Each component recipe is intentionally minimal — one text field, no
  // variants except where the partial-design layout pins one. The
  // composition layer doesn't care about the component's internal shape;
  // we just need GUIDs the layout XML can resolve.
  const buildComponent = (
    key: SymbolicKey,
    options: {
      variants?: string[];
      hasParams?: boolean;
    } = {}
  ): ComponentTemplateRecipe => ({
    kind: "component-template",
    schemaVersion: "1",
    handle: h(key),
    name: n(key),
    displayName: `${n(key)} Component`,
    fields: [
      {
        name: "Heading",
        shape: "text",
        sitecore: { type: "single-line-text", sortOrder: 100 },
      },
    ],
    variants: (options.variants ?? []).map((name) => ({ name })),
    params: options.hasParams
      ? [
          {
            name: "Size",
            shape: "enum",
            values: ["sm", "md", "lg"],
            default: "md",
            sitecore: { type: "droplist", sortOrder: 100 },
          },
        ]
      : [],
    rendering: {
      datasourceLocation: "current-item",
      openPropertiesAfterAdd: false,
    },
  });

  const siteLogo = buildComponent("siteLogo");
  const primaryNav = buildComponent("primaryNav");
  const utilityNav = buildComponent("utilityNav");
  const ctaBanner = buildComponent("ctaBanner", { variants: ["Default", "Outline"] });
  const authorAvatar = buildComponent("authorAvatar", { hasParams: true });
  const authorInfo = buildComponent("authorInfo");
  const readTime = buildComponent("readTime");
  const footerLinkGrid = buildComponent("footerLinkGrid");
  const footerSocial = buildComponent("footerSocial", { variants: ["IconsOnly", "Labeled"] });
  const footerCopyright = buildComponent("footerCopyright");

  // ---------------- content items (9 + 3 nav-link children) ----------------
  const siteLogoContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("siteLogoContent"),
    name: n("siteLogoContent"),
    displayName: `Site Logo Content (${runId})`,
    templateType: h("textBlockTpl"),
    fields: {
      Title: { shape: "text", value: "Demo Registry" },
      Body: {
        shape: "richText",
        value: "<p>Welcome to the Phase 4 sandbox demo registry.</p>",
      },
    },
  };

  const navLinkProducts: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("navLinkProducts"),
    name: n("navLinkProducts"),
    displayName: `Nav Link – Products (${runId})`,
    templateType: h("navLinkTpl"),
    fields: { Label: { shape: "text", value: "Products" } },
  };
  const navLinkPricing: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("navLinkPricing"),
    name: n("navLinkPricing"),
    displayName: `Nav Link – Pricing (${runId})`,
    templateType: h("navLinkTpl"),
    fields: { Label: { shape: "text", value: "Pricing" } },
  };
  const navLinkDocs: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("navLinkDocs"),
    name: n("navLinkDocs"),
    displayName: `Nav Link – Docs (${runId})`,
    templateType: h("navLinkTpl"),
    fields: { Label: { shape: "text", value: "Docs" } },
  };

  const primaryNavContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("primaryNavContent"),
    name: n("primaryNavContent"),
    displayName: `Primary Nav Content (${runId})`,
    templateType: h("navListTpl"),
    fields: {
      Label: { shape: "text", value: "Primary" },
      Items: {
        shape: "reference",
        refs: [h("navLinkProducts"), h("navLinkPricing"), h("navLinkDocs")],
      },
    },
  };

  const utilityNavContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("utilityNavContent"),
    name: n("utilityNavContent"),
    displayName: `Utility Nav Content (${runId})`,
    templateType: h("navListTpl"),
    fields: {
      Label: { shape: "text", value: "Utility" },
      // Reuse the same nav-link items — utility nav typically holds a
      // smaller subset (sign-in, search). For sandbox we just need the
      // reference shape exercised; one entry is enough.
      Items: { shape: "reference", refs: [h("navLinkDocs")] },
    },
  };

  const footerGridContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("footerGridContent"),
    name: n("footerGridContent"),
    displayName: `Footer Grid Content (${runId})`,
    templateType: h("textBlockTpl"),
    fields: {
      Title: { shape: "text", value: "Resources" },
      Body: { shape: "richText", value: "<ul><li>Docs</li><li>Status</li></ul>" },
    },
  };

  const footerSocialContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("footerSocialContent"),
    name: n("footerSocialContent"),
    displayName: `Footer Social Content (${runId})`,
    templateType: h("footerSocialTpl"),
    fields: {
      X: { shape: "link-external", href: "https://x.com/sitecore", text: "@sitecore" },
      LinkedIn: {
        shape: "link-external",
        href: "https://www.linkedin.com/company/sitecore",
        text: "Sitecore",
      },
      GitHub: { shape: "link-external", href: "https://github.com/sitecore", text: "sitecore" },
    },
  };

  const footerCopyrightContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("footerCopyrightContent"),
    name: n("footerCopyrightContent"),
    displayName: `Footer Copyright Content (${runId})`,
    templateType: h("textBlockTpl"),
    fields: {
      Title: { shape: "text", value: "Copyright" },
      Body: { shape: "richText", value: "<p>© 2026 Demo Registry. All rights reserved.</p>" },
    },
  };

  const bylineAuthorContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("bylineAuthorContent"),
    name: n("bylineAuthorContent"),
    displayName: `Byline Author Content (${runId})`,
    templateType: h("textBlockTpl"),
    fields: {
      Title: { shape: "text", value: "Liz Nelson" },
      Body: { shape: "richText", value: "<p>Sandbox engineer at Sitecore.</p>" },
    },
  };

  const landingCtaContent: ContentItemRecipe = {
    kind: "content-item",
    schemaVersion: "1",
    handle: h("landingCtaContent"),
    name: n("landingCtaContent"),
    displayName: `Landing CTA Content (${runId})`,
    templateType: h("textBlockTpl"),
    fields: {
      Title: { shape: "text", value: "Try the demo" },
      Body: { shape: "richText", value: "<p>Sign up for a free sandbox tenant.</p>" },
    },
  };

  // ---------------- partial designs (3) ----------------
  const standardHeader: PartialDesignRecipe = {
    kind: "partial-design",
    schemaVersion: "1",
    handle: h("standardHeader"),
    name: n("standardHeader"),
    displayName: `Standard Header (${runId})`,
    description: "Phase-4 sandbox fixture: site logo + primary + utility nav.",
    layout: {
      placeholders: {
        "/header": [
          {
            componentHandle: h("siteLogo"),
            datasourceRef: { kind: "shared", handle: h("siteLogoContent") },
          },
          {
            componentHandle: h("primaryNav"),
            datasourceRef: { kind: "shared", handle: h("primaryNavContent") },
          },
          {
            componentHandle: h("utilityNav"),
            datasourceRef: { kind: "shared", handle: h("utilityNavContent") },
          },
        ],
      },
    },
  };

  const standardFooter: PartialDesignRecipe = {
    kind: "partial-design",
    schemaVersion: "1",
    handle: h("standardFooter"),
    name: n("standardFooter"),
    displayName: `Standard Footer (${runId})`,
    description: "Phase-4 sandbox fixture: link grid + social + copyright.",
    layout: {
      placeholders: {
        "/footer": [
          {
            componentHandle: h("footerLinkGrid"),
            datasourceRef: { kind: "shared", handle: h("footerGridContent") },
          },
          {
            componentHandle: h("footerSocial"),
            // Variant pin exercised on this placement so the layout XML's
            // `par="FieldNames=icons-only"` byte-equality comparison
            // covers the variant-encoding path.
            variant: "icons-only",
            datasourceRef: { kind: "shared", handle: h("footerSocialContent") },
          },
          {
            componentHandle: h("footerCopyright"),
            datasourceRef: { kind: "shared", handle: h("footerCopyrightContent") },
          },
        ],
      },
    },
  };

  const articleByline: PartialDesignRecipe = {
    kind: "partial-design",
    schemaVersion: "1",
    handle: h("articleByline"),
    name: n("articleByline"),
    displayName: `Article Byline (${runId})`,
    description: "Phase-4 sandbox fixture: avatar + author info + read time.",
    layout: {
      placeholders: {
        "/article-meta": [
          {
            componentHandle: h("authorAvatar"),
            // Params blob exercise — `Size=sm` rides on the placement.
            params: { Size: "sm" },
            datasourceRef: { kind: "none" },
          },
          {
            componentHandle: h("authorInfo"),
            datasourceRef: { kind: "shared", handle: h("bylineAuthorContent") },
          },
          {
            componentHandle: h("readTime"),
            datasourceRef: { kind: "none" },
          },
        ],
      },
    },
  };

  // ---------------- page designs (3) ----------------
  const defaultPageDesign: PageDesignRecipe = {
    kind: "page-design",
    schemaVersion: "1",
    handle: h("defaultPageDesign"),
    name: n("defaultPageDesign"),
    displayName: `Default Page Design (${runId})`,
    description: "Phase-4 sandbox fixture: header + footer wrapper.",
    appliesTo: [h("homePage")],
    partials: [h("standardHeader"), h("standardFooter")],
  };

  const landingPageDesign: PageDesignRecipe = {
    kind: "page-design",
    schemaVersion: "1",
    handle: h("landingPageDesign"),
    name: n("landingPageDesign"),
    displayName: `Landing Page Design (${runId})`,
    description: "Phase-4 sandbox fixture: footer-only with own CTA placement.",
    appliesTo: [h("landingPage")],
    partials: [h("standardFooter")],
    layout: {
      placeholders: {
        "/page-design-cta": [
          {
            componentHandle: h("ctaBanner"),
            variant: "default",
            datasourceRef: { kind: "shared", handle: h("landingCtaContent") },
          },
        ],
      },
    },
  };

  const articlePageDesign: PageDesignRecipe = {
    kind: "page-design",
    schemaVersion: "1",
    handle: h("articlePageDesign"),
    name: n("articlePageDesign"),
    displayName: `Article Page Design (${runId})`,
    description: "Phase-4 sandbox fixture: header + byline + footer.",
    appliesTo: [h("articlePage")],
    partials: [h("standardHeader"), h("articleByline"), h("standardFooter")],
  };

  // ---------------- ordered set ----------------
  // Order matters for the executor's captured-itemId map: producers must
  // come before consumers in the concatenated op stream. Templates first,
  // then components, then content items (which reference templates), then
  // partials (which reference components + content items), then page
  // designs (which reference partials + page templates).
  const recipes: Recipe[] = [
    // page templates first — content items referencing them resolve via
    // captured-itemId on the same push.
    homePageTpl,
    landingPageTpl,
    articlePageTpl,
    // shared data templates next.
    textBlockTpl,
    navListTpl,
    navLinkTpl,
    footerSocialTpl,
    // component templates — they own their datasource templates, plus
    // they're prerequisites for partial-design layout XML resolution.
    siteLogo,
    primaryNav,
    utilityNav,
    ctaBanner,
    authorAvatar,
    authorInfo,
    readTime,
    footerLinkGrid,
    footerSocial,
    footerCopyright,
    // child content items referenced by primary-nav/utility-nav before
    // their parents.
    navLinkProducts,
    navLinkPricing,
    navLinkDocs,
    // shared content items.
    siteLogoContent,
    primaryNavContent,
    utilityNavContent,
    footerGridContent,
    footerSocialContent,
    footerCopyrightContent,
    bylineAuthorContent,
    landingCtaContent,
    // partial designs last among the per-recipe IRs.
    standardHeader,
    standardFooter,
    articleByline,
    // page designs (depend on partials + page templates).
    defaultPageDesign,
    landingPageDesign,
    articlePageDesign,
  ];

  return { recipes, handle, name };
}
