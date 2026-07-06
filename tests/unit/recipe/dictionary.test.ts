import { describe, expect, it } from "vitest";
import {
  compileDictionaryRecipe,
  compileRecipe,
  type CompileContext,
} from "../../../src/recipe/compile";
import { dictionaryFolderId, dictionaryPhraseId } from "../../../src/recipe/items/guids";
import type { CreateItemOp, SetFieldOp } from "../../../src/recipe/ir/operations";
import {
  DICTIONARY_ENTRY_FIELDS,
  DICTIONARY_TEMPLATE_PATHS,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type { DictionaryRecipe, SiteRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Unit tests for `compileDictionaryRecipe` — the IR shape per phrase,
 * per-locale version emission, host-site resolution, and the
 * description / translator-note `__Help text` write.
 *
 * Live-tenant verification (does SXA actually inherit the dictionary
 * across sibling sites when `siteRole: 'shared'`?) is a separate
 * sandbox milestone — these tests assert the IR is correct, not the
 * Sitecore behaviour.
 */

const HOST_SITE: SiteRecipe = {
  kind: "site",
  schemaVersion: "1",
  handle: "showcase-shared@1",
  name: "Shared",
  displayName: "Shared",
  siteTemplate: "showcase-site-template@1",
  language: "en",
  collectionName: "Showcase",
  siteRole: "shared",
};

const SHARED_LABELS: DictionaryRecipe = {
  kind: "dictionary",
  schemaVersion: "1",
  handle: "core-ui-labels@1",
  name: "CoreUiLabels",
  displayName: "Core UI Labels",
  description: "Generic chrome + form labels",
  site: "showcase-shared@1",
  primaryLocale: "en",
  phrases: {
    "cta-learn-more": {
      defaultValue: "Learn more",
      translations: {
        fr: "En savoir plus",
        de: "Mehr erfahren",
      },
      description: "Generic learn-more CTA used on cards + heroes.",
    },
    "cta-sign-up": {
      defaultValue: "Sign up",
    },
  },
};

const CONTEXT_WITH_HOST: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Showcase/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Showcase",
  sitesByHandle: new Map([[HOST_SITE.handle, HOST_SITE]]),
};

describe("compileDictionaryRecipe — host-site resolution", () => {
  it("emits the Dictionary Folder under <hostSitePath>/Dictionary/<recipe.name>", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const folder = ir.operations.find(
      (o): o is CreateItemOp =>
        o.op === "CreateItem" && o.label === `dictionary-folder:${SHARED_LABELS.handle}`
    );
    expect(folder).toBeDefined();
    expect(folder?.path).toBe(`/sitecore/content/Showcase/Shared/Dictionary/${SHARED_LABELS.name}`);
    expect(folder?.id).toBe(dictionaryFolderId(HOST_SITE.handle, SHARED_LABELS.name));
    expect(folder?.templateOf).toEqual({
      kind: "ref-path",
      value: DICTIONARY_TEMPLATE_PATHS.FOLDER,
    });
  });

  it("uses collectionPath when set on the host SiteRecipe (overrides collectionName-derived default)", () => {
    const customHost: SiteRecipe = {
      ...HOST_SITE,
      collectionPath: "/sitecore/content/Marketing/Brands/",
    };
    const ir = compileDictionaryRecipe(SHARED_LABELS, {
      ...CONTEXT_WITH_HOST,
      sitesByHandle: new Map([[customHost.handle, customHost]]),
    });
    const folder = ir.operations.find(
      (o): o is CreateItemOp => o.op === "CreateItem" && o.label.startsWith("dictionary-folder:")
    );
    expect(folder?.path).toBe(
      `/sitecore/content/Marketing/Brands/Shared/Dictionary/${SHARED_LABELS.name}`
    );
  });

  it("prefers context.crossRecipeSitePaths over sitesByHandle when both are present", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, {
      ...CONTEXT_WITH_HOST,
      crossRecipeSitePaths: { [HOST_SITE.handle]: "/sitecore/content/Direct/Path" },
    });
    const folder = ir.operations.find(
      (o): o is CreateItemOp => o.op === "CreateItem" && o.label.startsWith("dictionary-folder:")
    );
    expect(folder?.path).toBe(`/sitecore/content/Direct/Path/Dictionary/${SHARED_LABELS.name}`);
  });

  it("throws INPUT_INVALID when an explicit host site resolves via neither sitesByHandle nor crossRecipeSitePaths", () => {
    expect(() =>
      compileDictionaryRecipe(SHARED_LABELS, {
        templatesRoot: CONTEXT_WITH_HOST.templatesRoot,
        renderingsRoot: CONTEXT_WITH_HOST.renderingsRoot,
      })
    ).toThrow(/host SiteRecipe 'showcase-shared@1'.*is not in the recipe set/);
  });
});

/**
 * The common case: a dictionary with NO `site` handle. It installs into
 * the deploy's TARGET site (`context.sitePathSegment`, the
 * `<siteCollection>/<site>` from the active env profile) — parity with
 * how pages and enums install, with no in-set SiteRecipe required.
 */
describe("compileDictionaryRecipe — no host site (installs into deploy target)", () => {
  const SITELESS_LABELS: DictionaryRecipe = {
    kind: "dictionary",
    schemaVersion: "1",
    handle: "core-ui-labels@1",
    name: "CoreUiLabels",
    displayName: "Core UI Labels",
    primaryLocale: "en",
    phrases: { "cta-sign-up": { defaultValue: "Sign up" } },
  };

  const CONTEXT_DEPLOY_TARGET: CompileContext = {
    templatesRoot: "/sitecore/templates/Project/Showcase/Components",
    renderingsRoot: "/sitecore/layout/Renderings/Project/Showcase",
    site: "showcase-site",
    sitePathSegment: "Showcase/showcase-site",
  };

  it("lands the Dictionary Folder under /sitecore/content/<sitePathSegment>/Dictionary/<name>", () => {
    const ir = compileDictionaryRecipe(SITELESS_LABELS, CONTEXT_DEPLOY_TARGET);
    const folder = ir.operations.find(
      (o): o is CreateItemOp => o.op === "CreateItem" && o.label.startsWith("dictionary-folder:")
    );
    expect(folder?.path).toBe(
      `/sitecore/content/Showcase/showcase-site/Dictionary/${SITELESS_LABELS.name}`
    );
  });

  it("seeds site-scoped refKeys off context.site so re-pushes stay stable", () => {
    const ir = compileDictionaryRecipe(SITELESS_LABELS, CONTEXT_DEPLOY_TARGET);
    const entry = ir.operations.find(
      (o): o is CreateItemOp => o.op === "CreateItem" && o.label.startsWith("dictionary-entry:")
    );
    expect(entry?.id).toBe(dictionaryPhraseId("showcase-site", "cta-sign-up"));
  });

  it("compiles WITHOUT any sitesByHandle / crossRecipeSitePaths wiring", () => {
    // No in-set SiteRecipe is needed — the whole point of the pattern.
    expect(() => compileDictionaryRecipe(SITELESS_LABELS, CONTEXT_DEPLOY_TARGET)).not.toThrow();
  });

  it("throws a targeted INPUT_INVALID when the deploy target site is unconfigured", () => {
    expect(() =>
      compileDictionaryRecipe(SITELESS_LABELS, {
        templatesRoot: CONTEXT_DEPLOY_TARGET.templatesRoot,
        renderingsRoot: CONTEXT_DEPLOY_TARGET.renderingsRoot,
      })
    ).toThrow(/has no host site.*no site path is configured/);
  });
});

describe("compileDictionaryRecipe — per-phrase IR shape", () => {
  it("emits one CreateItem per phrase, parented to the folder via ref-recipe", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const folderRefKey = dictionaryFolderId(HOST_SITE.handle, SHARED_LABELS.name);
    const entries = ir.operations.filter(
      (o): o is CreateItemOp => o.op === "CreateItem" && o.label.startsWith("dictionary-entry:")
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.parent).toEqual({ kind: "ref-recipe", refKey: folderRefKey });
      expect(entry.templateOf).toEqual({
        kind: "ref-path",
        value: DICTIONARY_TEMPLATE_PATHS.ENTRY,
      });
    }
  });

  it("emits phrase entries in sorted key order for deterministic IRs", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const entryNames = ir.operations
      .filter(
        (o): o is CreateItemOp => o.op === "CreateItem" && o.label.startsWith("dictionary-entry:")
      )
      .map((o) => o.name);
    expect(entryNames).toEqual(["cta-learn-more", "cta-sign-up"]);
  });

  it("stamps the Key field with the phrase key (stable identifier consumers reference)", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const learnMore = ir.operations.find(
      (o): o is CreateItemOp =>
        o.op === "CreateItem" &&
        o.label === `dictionary-entry:${SHARED_LABELS.handle}/cta-learn-more`
    );
    const keyField = learnMore?.fields.find((f) => f.fieldId === DICTIONARY_ENTRY_FIELDS.KEY);
    expect(keyField).toBeDefined();
    expect(keyField?.value).toEqual({ kind: "string", value: "cta-learn-more" });
    expect(keyField?.fieldName).toBe("Key");
  });

  it("uses the SAME refKey as `dictionaryPhraseId(site, phrase)` so overrides line up", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const signUp = ir.operations.find(
      (o): o is CreateItemOp =>
        o.op === "CreateItem" && o.label === `dictionary-entry:${SHARED_LABELS.handle}/cta-sign-up`
    );
    expect(signUp?.id).toBe(dictionaryPhraseId(HOST_SITE.handle, "cta-sign-up"));
  });
});

describe("compileDictionaryRecipe — per-locale version emission", () => {
  it("includes the primary-locale Phrase value on the CreateItem (no extra SetField)", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const learnMore = ir.operations.find(
      (o): o is CreateItemOp =>
        o.op === "CreateItem" &&
        o.label === `dictionary-entry:${SHARED_LABELS.handle}/cta-learn-more`
    );
    const enPhrase = learnMore?.fields.find(
      (f) => f.fieldId === DICTIONARY_ENTRY_FIELDS.PHRASE && f.language === "en"
    );
    expect(enPhrase).toBeDefined();
    expect(enPhrase?.value).toEqual({ kind: "string", value: "Learn more" });
    expect(enPhrase?.version).toBe(1);
  });

  it("emits one SetField per translation locale (sorted), each carrying language + version", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const translationOps = ir.operations.filter(
      (o): o is SetFieldOp =>
        o.op === "SetField" &&
        o.label.startsWith(`dictionary-entry-translation:${SHARED_LABELS.handle}/cta-learn-more`)
    );
    // Sorted alphabetically: de before fr.
    expect(translationOps.map((o) => o.language)).toEqual(["de", "fr"]);
    expect(translationOps[0].value).toEqual({ kind: "string", value: "Mehr erfahren" });
    expect(translationOps[1].value).toEqual({ kind: "string", value: "En savoir plus" });
    for (const op of translationOps) {
      expect(op.fieldId).toBe(DICTIONARY_ENTRY_FIELDS.PHRASE);
      expect(op.fieldName).toBe("Phrase");
      expect(op.version).toBe(1);
    }
  });

  it("emits an AddItemVersion for each translation locale BEFORE its Phrase SetField", () => {
    // Regression: a SetField against a language with no version yet fails
    // with "item ... does not contain version #1 in '<locale>'". Each
    // translation locale needs its version materialised first — and that
    // AddItemVersion must precede the locale's SetField in op order (the
    // executor applies ops sequentially by index).
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    for (const locale of ["de", "fr"]) {
      const addVersionIdx = ir.operations.findIndex(
        (o) =>
          o.op === "AddItemVersion" &&
          o.label === `dictionary-entry-version:${SHARED_LABELS.handle}/cta-learn-more:${locale}`
      );
      const setFieldIdx = ir.operations.findIndex(
        (o) =>
          o.op === "SetField" &&
          o.label ===
            `dictionary-entry-translation:${SHARED_LABELS.handle}/cta-learn-more:${locale}`
      );
      expect(addVersionIdx).toBeGreaterThanOrEqual(0);
      expect(setFieldIdx).toBeGreaterThan(addVersionIdx);
      const addVersion = ir.operations[addVersionIdx];
      expect(addVersion).toMatchObject({ language: locale, version: 1 });
    }
  });

  it("emits NO AddItemVersion for the primary locale (CreateItem already made it)", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const primaryVersionOps = ir.operations.filter(
      (o) => o.op === "AddItemVersion" && "language" in o && o.language === "en"
    );
    expect(primaryVersionOps).toHaveLength(0);
  });

  it("emits NO translation SetField ops for a phrase whose translations are omitted", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const ops = ir.operations.filter(
      (o) =>
        o.op === "SetField" &&
        o.label.startsWith(`dictionary-entry-translation:${SHARED_LABELS.handle}/cta-sign-up`)
    );
    expect(ops).toHaveLength(0);
  });

  it("skips an explicit primary-locale translation (already covered by the CreateItem)", () => {
    const recipe: DictionaryRecipe = {
      ...SHARED_LABELS,
      phrases: {
        echo: {
          defaultValue: "Echo",
          translations: { en: "Echo override", fr: "Écho" },
        },
      },
    };
    const ir = compileDictionaryRecipe(recipe, CONTEXT_WITH_HOST);
    const translationOps = ir.operations.filter(
      (o): o is SetFieldOp =>
        o.op === "SetField" &&
        o.label.startsWith(`dictionary-entry-translation:${recipe.handle}/echo`)
    );
    expect(translationOps).toHaveLength(1);
    expect(translationOps[0].language).toBe("fr");
  });

  it("falls back to en when primaryLocale is omitted on the recipe", () => {
    const recipe: DictionaryRecipe = {
      ...SHARED_LABELS,
      primaryLocale: undefined,
      phrases: { hello: { defaultValue: "Hi" } },
    };
    const ir = compileDictionaryRecipe(recipe, CONTEXT_WITH_HOST);
    const create = ir.operations.find(
      (o): o is CreateItemOp =>
        o.op === "CreateItem" && o.label === `dictionary-entry:${recipe.handle}/hello`
    );
    const phrase = create?.fields.find((f) => f.fieldId === DICTIONARY_ENTRY_FIELDS.PHRASE);
    expect(phrase?.language).toBe("en");
  });
});

describe("compileDictionaryRecipe — language alignment (availableLanguages)", () => {
  const translationLocales = (ir: ReturnType<typeof compileDictionaryRecipe>, phraseKey: string) =>
    ir.operations
      .filter(
        (o): o is SetFieldOp =>
          o.op === "SetField" &&
          o.label.startsWith(`dictionary-entry-translation:${SHARED_LABELS.handle}/${phraseKey}:`)
      )
      .map((o) => o.language);

  it("filters translation locales to the environment's languages (drops the rest)", () => {
    // cta-learn-more authors fr + de; the environment only has en + de.
    const ir = compileDictionaryRecipe(SHARED_LABELS, {
      ...CONTEXT_WITH_HOST,
      availableLanguages: ["en", "de"],
    });
    expect(translationLocales(ir, "cta-learn-more")).toEqual(["de"]);
    // The dropped locale emits neither a SetField nor an AddItemVersion.
    const frOps = ir.operations.filter((o) => o.label.endsWith("cta-learn-more:fr"));
    expect(frOps).toHaveLength(0);
  });

  it("matches case-insensitively and on the regional ISO form (pt-BR)", () => {
    const recipe: DictionaryRecipe = {
      ...SHARED_LABELS,
      phrases: {
        greeting: {
          defaultValue: "Hi",
          translations: { fr: "Salut", "pt-BR": "Oi" },
        },
      },
    };
    const ir = compileDictionaryRecipe(recipe, {
      ...CONTEXT_WITH_HOST,
      // Regional form, different case — still matches pt-BR; fr is absent.
      availableLanguages: ["EN", "PT-br"],
    });
    const locales = ir.operations
      .filter(
        (o): o is SetFieldOp =>
          o.op === "SetField" &&
          o.label.startsWith(`dictionary-entry-translation:${recipe.handle}/greeting:`)
      )
      .map((o) => o.language);
    expect(locales).toEqual(["pt-BR"]);
  });

  it("emits every authored translation when availableLanguages is unset (pre-alignment behaviour)", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    expect(translationLocales(ir, "cta-learn-more")).toEqual(["de", "fr"]);
  });

  it("always emits the primary locale even when it isn't in availableLanguages", () => {
    // Environment has only 'de'; the primary 'en' CreateItem still lands
    // (it's the default-language fallback).
    const ir = compileDictionaryRecipe(SHARED_LABELS, {
      ...CONTEXT_WITH_HOST,
      availableLanguages: ["de"],
    });
    const learnMore = ir.operations.find(
      (o): o is CreateItemOp =>
        o.op === "CreateItem" &&
        o.label === `dictionary-entry:${SHARED_LABELS.handle}/cta-learn-more`
    );
    const enPhrase = learnMore?.fields.find(
      (f) => f.fieldId === DICTIONARY_ENTRY_FIELDS.PHRASE && f.language === "en"
    );
    expect(enPhrase).toBeDefined();
    expect(translationLocales(ir, "cta-learn-more")).toEqual(["de"]);
  });
});

describe("compileDictionaryRecipe — description (translator note)", () => {
  it("emits a separate __Help text SetField when phrase.description is set", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const helpOp = ir.operations.find(
      (o): o is SetFieldOp =>
        o.op === "SetField" &&
        o.label === `dictionary-entry-description:${SHARED_LABELS.handle}/cta-learn-more`
    );
    expect(helpOp).toBeDefined();
    expect(helpOp?.fieldId).toBe(SYSTEM_FIELDS.HELP_TEXT);
    expect(helpOp?.value).toEqual({
      kind: "string",
      value: "Generic learn-more CTA used on cards + heroes.",
    });
  });

  it("omits the __Help text SetField when phrase.description is undefined", () => {
    const ir = compileDictionaryRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    const helpOp = ir.operations.find(
      (o) =>
        o.op === "SetField" &&
        o.label === `dictionary-entry-description:${SHARED_LABELS.handle}/cta-sign-up`
    );
    expect(helpOp).toBeUndefined();
  });
});

describe("compileDictionaryRecipe — dispatcher routing", () => {
  it("compileRecipe routes kind: dictionary through compileDictionaryRecipe", () => {
    const ir = compileRecipe(SHARED_LABELS, CONTEXT_WITH_HOST);
    expect(ir.recipeHandle).toBe(SHARED_LABELS.handle);
    expect(ir.operations[0].op).toBe("CreateItem");
    expect(ir.operations[0].label).toBe(`dictionary-folder:${SHARED_LABELS.handle}`);
  });

  it("emits zero entries when phrases is empty (folder only)", () => {
    const emptyRecipe: DictionaryRecipe = { ...SHARED_LABELS, phrases: {} };
    const ir = compileDictionaryRecipe(emptyRecipe, CONTEXT_WITH_HOST);
    const creates = ir.operations.filter((o) => o.op === "CreateItem");
    expect(creates).toHaveLength(1);
    expect(creates[0].label).toBe(`dictionary-folder:${SHARED_LABELS.handle}`);
  });
});
