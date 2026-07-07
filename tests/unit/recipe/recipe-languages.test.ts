import { describe, expect, it } from "vitest";
import { collectRecipeLanguages } from "../../../src/recipe/compile/languages";
import type { Recipe } from "../../../src/recipe/schema/recipe";

/**
 * `recipe list --json` emits each recipe's authored locale inventory so a
 * batch driver can scope its localize passes (`--languages fr-FR,de,…`) to
 * exactly the authored surface instead of unscoped (= every registered
 * locale, which on many-locale tenants fans base-language expansion far
 * past the authored content). Codes must pass through VERBATIM — a bare
 * base language keeps its regional-expansion semantics in `--languages`.
 */
describe("collectRecipeLanguages", () => {
  it("collects site language declarations", () => {
    const site = {
      kind: "site",
      handle: "my-site@1",
      language: "en",
      languages: ["fr-FR", "de"],
    } as unknown as Recipe;
    expect(collectRecipeLanguages(site)).toEqual(["de", "en", "fr-FR"]);
  });

  it("collects translations and story-mode versions record keys", () => {
    const contentItem = {
      kind: "content-item",
      handle: "site-logo-content@1",
      fields: { title: "Logo" },
      translations: { fr: { fields: {} }, "ja-JP": { fields: {} } },
    } as unknown as Recipe;
    expect(collectRecipeLanguages(contentItem)).toEqual(["fr", "ja-JP"]);

    const story = {
      kind: "content-item",
      handle: "hero-story@1",
      versions: { da: [], en: [] },
    } as unknown as Recipe;
    expect(collectRecipeLanguages(story)).toEqual(["da", "en"]);
  });

  it("collects dictionary phrase translations and primaryLocale", () => {
    const dictionary = {
      kind: "dictionary",
      handle: "core-ui-labels@1",
      primaryLocale: "en",
      phrases: {
        "cta-learn-more": {
          defaultValue: "Learn more",
          translations: { "fr-CA": "En savoir plus", de: "Mehr erfahren" },
        },
        "form-submit-label": { defaultValue: "Submit" },
      },
    } as unknown as Recipe;
    expect(collectRecipeLanguages(dictionary)).toEqual(["de", "en", "fr-CA"]);
  });

  it("collects locale-map field and param defaults, including sitecore.defaultValue", () => {
    const template = {
      kind: "component-template",
      handle: "tagline-banner@1",
      fields: [
        { name: "headline", shape: "text", default: { en: "Hello", es: "Hola" } },
        { name: "plain", shape: "text", default: "just a string" },
        {
          name: "hinted",
          shape: "text",
          sitecore: { defaultValue: { en: "Hi", "pt-BR": "Oi" } },
        },
      ],
      params: [{ name: "tone", shape: "text", default: { en: "calm", nl: "rustig" } }],
    } as unknown as Recipe;
    expect(collectRecipeLanguages(template)).toEqual(["en", "es", "nl", "pt-BR"]);
  });

  it("ignores content-item `fields` records (values, not definitions)", () => {
    const contentItem = {
      kind: "content-item",
      handle: "nav-content@1",
      // Record keyed by FIELD NAME — must not be mistaken for locales.
      fields: { title: "Home", subtitle: "Welcome" },
    } as unknown as Recipe;
    expect(collectRecipeLanguages(contentItem)).toEqual([]);
  });

  it("returns an empty inventory for kinds with no localized content", () => {
    const enumeration = {
      kind: "enumeration",
      handle: "color-scheme@1",
      values: ["primary", "secondary"],
    } as unknown as Recipe;
    expect(collectRecipeLanguages(enumeration)).toEqual([]);
  });
});
