import { describe, expect, it, vi } from "vitest";
import type { SitesApiClient } from "../../../../src/recipe/api/sites-client";
import { ensureEnvironmentLanguages } from "../../../../src/recipe/runtime/execute";
import { fallbackLanguageIsoFor } from "../../../../src/sites/api/languages";

/**
 * Fallback-language wiring on environment-language provisioning: every
 * ensured language gets a `fallbackLanguageIso` matching the base-locale
 * model (regional → base when present → en; base → en; en → none), and
 * pre-existing languages missing a fallback are repaired — but an
 * operator-configured fallback is never overwritten.
 */

const makeClient = (
  existing: Array<{ iso?: string; regionalIsoCode?: string; fallbackLanguageIso?: string | null }>
) => {
  const client = {
    listLanguages: vi.fn().mockResolvedValue(existing),
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
    await expect(ensureEnvironmentLanguages(client, ["da-DK"])).resolves.toBeUndefined();
    expect(client.addLanguage).toHaveBeenCalledWith("da-DK");
  });
});
