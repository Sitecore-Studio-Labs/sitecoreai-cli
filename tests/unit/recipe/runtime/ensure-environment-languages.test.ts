import { describe, expect, it, vi } from "vitest";
import type { Site, SitesApiClient } from "../../../../src/recipe/api/sites-client";
import {
  appendSiteLanguages,
  ensureEnvironmentLanguages,
} from "../../../../src/recipe/runtime/execute";
import { fallbackLanguageIsoFor } from "../../../../src/sites/api/languages";

/**
 * Fallback-language wiring on environment-language provisioning: every
 * ensured language gets a `fallbackLanguageIso` matching the base-locale
 * model (regional → base when present → en; base → en; en → none), and
 * pre-existing languages missing a fallback are repaired — but an
 * operator-configured fallback is never overwritten.
 */

const makeClient = (
  existing: Array<{ iso?: string; regionalIsoCode?: string; fallbackLanguageIso?: string | null }>,
  supported: Array<{
    name?: string | null;
    languageCode?: string | null;
    regionCode?: string | null;
  }> = []
) => {
  const client = {
    listLanguages: vi.fn().mockResolvedValue(existing),
    // Default [] = "catalog unknown" — the ensure treats an empty catalog
    // as no gate, so the pre-catalog tests keep their semantics.
    listSupportedLanguages: vi.fn().mockResolvedValue(supported),
    addLanguage: vi.fn().mockResolvedValue({}),
    updateLanguage: vi.fn().mockResolvedValue(undefined),
  } as unknown as SitesApiClient;
  return client;
};

describe("fallbackLanguageIsoFor", () => {
  const present = new Set(["en", "ar", "ar-ae", "de-de"]);
  it("regional falls back to its base when the environment carries it", () => {
    expect(fallbackLanguageIsoFor("ar-AE", present)).toBe("ar");
  });
  it("regional falls back to en when the base is absent", () => {
    expect(fallbackLanguageIsoFor("de-DE", present)).toBe("en");
  });
  it("a base language falls back to en", () => {
    expect(fallbackLanguageIsoFor("ar", present)).toBe("en");
  });
  it("en regionals fall back to en; en itself gets none", () => {
    expect(fallbackLanguageIsoFor("en-GB", present)).toBe("en");
    expect(fallbackLanguageIsoFor("en", present)).toBeNull();
  });
});

describe("ensureEnvironmentLanguages — fallback wiring", () => {
  it("adds bases before regionals and wires each new language's fallback", async () => {
    const client = makeClient([{ iso: "en", fallbackLanguageIso: null }]);
    await ensureEnvironmentLanguages(client, ["ar-AE", "ar"]);

    const addOrder = vi.mocked(client.addLanguage).mock.calls.map((c) => c[0]);
    expect(addOrder).toEqual(["ar", "ar-AE"]);

    const updates = vi.mocked(client.updateLanguage).mock.calls;
    expect(updates).toContainEqual(["ar", { languageCode: "ar", fallbackLanguageIso: "en" }]);
    expect(updates).toContainEqual([
      "ar-AE",
      { languageCode: "ar", regionCode: "AE", fallbackLanguageIso: "ar" },
    ]);
  });

  it("repairs a pre-existing language with an empty fallback, never an operator-set one", async () => {
    const client = makeClient([
      { iso: "en", fallbackLanguageIso: null },
      { iso: "de", regionalIsoCode: "de-DE", fallbackLanguageIso: "" },
      { iso: "fr", regionalIsoCode: "fr-FR", fallbackLanguageIso: "en" },
    ]);
    await ensureEnvironmentLanguages(client, ["de-DE"]);

    const updated = vi.mocked(client.updateLanguage).mock.calls.map((c) => c[0]);
    expect(updated).toContain("de-DE"); // empty fallback → repaired
    expect(updated).not.toContain("fr-FR"); // operator-set → untouched
    expect(updated).not.toContain("en"); // en never gets a fallback
  });

  it("a failed fallback PATCH never fails the provisioning", async () => {
    const client = makeClient([]);
    vi.mocked(client.updateLanguage).mockRejectedValue(new Error("403"));
    // Resolves (with the env's post-ensure code set) despite the PATCH failure.
    await expect(ensureEnvironmentLanguages(client, ["da-DK"])).resolves.toContain("da-dk");
    expect(client.addLanguage).toHaveBeenCalledWith("da-DK");
  });
});

describe("ensureEnvironmentLanguages — supported-catalog gate", () => {
  const CATALOG = [
    { name: "en", languageCode: "en", regionCode: "" },
    { name: "de-DE", languageCode: "de", regionCode: "DE" },
  ];

  it("registers only catalog codes — a base admission code (de) is skipped, its regional (de-DE) lands", async () => {
    // The localize fan-out legitimately scopes a step to bare `de` (base-
    // fallback content for a brand declaring de-DE) — provisioning must
    // NOT try to register it: the Sites API rejects it and aborts the push.
    const client = makeClient([{ iso: "en" }], CATALOG);
    await ensureEnvironmentLanguages(client, ["de", "de-DE"]);

    const addOrder = vi.mocked(client.addLanguage).mock.calls.map((c) => c[0]);
    expect(addOrder).toEqual(["de-DE"]);
    // No fallback wiring for the skipped code either.
    const updated = vi.mocked(client.updateLanguage).mock.calls.map((c) => c[0]);
    expect(updated).not.toContain("de");
  });

  it("a regional catalog entry does NOT make its bare base registrable", async () => {
    const client = makeClient(
      [{ iso: "en" }],
      [{ name: "de-DE", languageCode: "de", regionCode: "DE" }]
    );
    await ensureEnvironmentLanguages(client, ["de"]);
    expect(client.addLanguage).not.toHaveBeenCalled();
  });

  it("an unreadable catalog degrades to per-code tolerance: an unregistrable code skips, the rest land", async () => {
    const client = makeClient([{ iso: "en" }]);
    vi.mocked(client.listSupportedLanguages).mockRejectedValue(new Error("500"));
    vi.mocked(client.addLanguage).mockImplementation(async (code: string) => {
      if (code === "de") {
        throw new Error("The provided language 'de' with region code '' is not supported.");
      }
      return {} as never;
    });

    // Resolves despite the per-code rejection; the skipped code stays OUT
    // of the returned env set so it can't leak into site-level writes.
    const result = await ensureEnvironmentLanguages(client, ["de", "de-DE"]);
    expect(result.has("de-de")).toBe(true);
    expect(result.has("de")).toBe(false);
    const addOrder = vi.mocked(client.addLanguage).mock.calls.map((c) => c[0]);
    expect(addOrder).toEqual(["de", "de-DE"]);
    const updated = vi.mocked(client.updateLanguage).mock.calls.map((c) => c[0]);
    expect(updated).not.toContain("de");
    expect(updated).toContain("de-DE");
  });

  it("a genuine addLanguage failure still throws", async () => {
    const client = makeClient([{ iso: "en" }], CATALOG);
    vi.mocked(client.addLanguage).mockRejectedValue(new Error("502 upstream exploded"));
    await expect(ensureEnvironmentLanguages(client, ["de-DE"])).rejects.toThrow("502");
  });

  it("does not fetch the catalog when nothing is missing", async () => {
    const client = makeClient([{ iso: "en" }, { iso: "de", regionalIsoCode: "de-DE" }], CATALOG);
    await ensureEnvironmentLanguages(client, ["en", "de-DE"]);
    expect(client.listSupportedLanguages).not.toHaveBeenCalled();
    expect(client.addLanguage).not.toHaveBeenCalled();
  });
});

describe("ensureEnvironmentLanguages — returns the SITE-WRITABLE set (no bare bases)", () => {
  it("a registered de-DE yields de-DE in the return but NOT the bare de its iso would add", async () => {
    // presentLanguageCodes (env-internal) adds both `de` and `de-DE`, but
    // the RETURN gates site writes — and the Sites API rejects a bare `de`
    // on a supportedLanguages PATCH. So the return must carry only the
    // regional identity.
    const client = makeClient([
      { iso: "en", regionalIsoCode: "en" },
      { iso: "de", regionalIsoCode: "de-DE" },
    ]);
    const writable = await ensureEnvironmentLanguages(client, ["en", "de-DE"]);
    expect(writable.has("de-de")).toBe(true);
    expect(writable.has("de")).toBe(false);
    expect(writable.has("en")).toBe(true);
  });

  it("a freshly-added regional (de-CH) is in the return; the base admission code (de) is not", async () => {
    const CATALOG = [
      { name: "en", languageCode: "en", regionCode: "" },
      { name: "de-CH", languageCode: "de", regionCode: "CH" },
    ];
    const client = makeClient([{ iso: "en", regionalIsoCode: "en" }], CATALOG);
    // Scope rides bare `de` (fallback base) + de-CH; only de-CH is
    // registrable, and only de-CH is site-writable.
    const writable = await ensureEnvironmentLanguages(client, ["de", "de-CH"]);
    expect(writable.has("de-ch")).toBe(true);
    expect(writable.has("de")).toBe(false);
  });
});

describe("appendSiteLanguages — writes only the passed site-writable codes", () => {
  const makeSiteClient = (supportedLanguages: string[]) => {
    const updateSite = vi.fn(async () => ({}) as Site);
    const client = {
      retrieveSite: vi.fn(async () => ({ supportedLanguages }) as Site),
      updateSite,
    } as unknown as SitesApiClient;
    return { client, updateSite };
  };

  it("appends the missing site-writable codes to supportedLanguages (additive)", async () => {
    const { client, updateSite } = makeSiteClient(["en"]);
    await appendSiteLanguages(
      client,
      { siteId: "s1", missing: ["de-DE", "de-CH"] },
      new Set(["en", "de-de", "de-ch"])
    );
    expect(updateSite).toHaveBeenCalledWith("s1", {
      supportedLanguages: ["en", "de-DE", "de-CH"],
    });
  });

  it("no-ops when a missing code is not in the site-writable set (a bare base can never slip through)", async () => {
    const { client, updateSite } = makeSiteClient(["en", "de-DE"]);
    // `de` is absent from the site-writable set (ensure excluded it), so
    // nothing to add — and it never reaches a PATCH.
    await appendSiteLanguages(client, { siteId: "s1", missing: ["de"] }, new Set(["en", "de-de"]));
    expect(updateSite).not.toHaveBeenCalled();
  });
});
