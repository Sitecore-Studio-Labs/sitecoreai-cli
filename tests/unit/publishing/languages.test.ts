import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import {
  lookupSiteLanguages,
  lookupTenantLanguages,
  resolvePublishingLocales,
} from "../../../src/publishing/api/languages";
import { Logger } from "../../../src/shared/logger";
import { ScaiError } from "../../../src/shared/errors";

const noopLogger = new Logger(false, false, false, true);

vi.mock("../../../src/auth/client-credentials", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

vi.mock("../../../src/sites/api/sites", () => ({
  listSites: vi.fn(),
}));

vi.mock("../../../src/sites/api/languages", () => ({
  listLanguages: vi.fn(),
}));

import { listSites } from "../../../src/sites/api/sites";
import { listLanguages } from "../../../src/sites/api/languages";

const mockListSites = listSites as unknown as ReturnType<typeof vi.fn>;
const mockListLanguages = listLanguages as unknown as ReturnType<typeof vi.fn>;

const env: EnvironmentConfiguration = {
  name: "sandbox",
  host: "host.example",
} as EnvironmentConfiguration;

beforeEach(() => {
  mockListSites.mockReset();
  mockListLanguages.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("lookupSiteLanguages", () => {
  it("returns the configured languages for a named site", async () => {
    mockListSites.mockResolvedValue([
      { name: "marketing", languages: ["en-US", "fr-CA"] },
      { name: "support", languages: ["en"] },
    ]);
    expect(await lookupSiteLanguages(env, "marketing")).toEqual(["en-US", "fr-CA"]);
  });

  it("filters out null entries in the languages array", async () => {
    mockListSites.mockResolvedValue([{ name: "marketing", languages: ["en-US", null, "fr-CA"] }]);
    expect(await lookupSiteLanguages(env, "marketing")).toEqual(["en-US", "fr-CA"]);
  });

  it("returns empty array when the site has no configured languages", async () => {
    mockListSites.mockResolvedValue([{ name: "blank", languages: [] }]);
    expect(await lookupSiteLanguages(env, "blank")).toEqual([]);
  });

  it("throws INPUT_INVALID with an `available sites` hint when the site doesn't exist", async () => {
    mockListSites.mockResolvedValue([
      { name: "marketing", languages: ["en"] },
      { name: "support", languages: ["en"] },
    ]);
    await expect(lookupSiteLanguages(env, "nope")).rejects.toMatchObject({
      code: "INPUT_INVALID",
      hint: expect.stringContaining("marketing"),
    });
  });

  it("caps the 'available sites' hint at 12 names to avoid spamming the console", async () => {
    mockListSites.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ name: `site-${i}`, languages: ["en"] }))
    );
    await expect(lookupSiteLanguages(env, "missing")).rejects.toMatchObject({
      hint: expect.stringContaining("(and 8 more)"),
    });
  });

  it("rejects with ScaiError instance on missing site", async () => {
    mockListSites.mockResolvedValue([{ name: "other", languages: ["en"] }]);
    await expect(lookupSiteLanguages(env, "nope")).rejects.toBeInstanceOf(ScaiError);
  });
});

describe("lookupTenantLanguages", () => {
  it("returns the names of all tenant languages", async () => {
    mockListLanguages.mockResolvedValue([{ name: "en-US" }, { name: "fr-CA" }, { name: "de-DE" }]);
    expect(await lookupTenantLanguages(env)).toEqual(["en-US", "fr-CA", "de-DE"]);
  });

  it("filters out entries with no name", async () => {
    mockListLanguages.mockResolvedValue([{ name: "en" }, { name: null }, { name: "" }]);
    expect(await lookupTenantLanguages(env)).toEqual(["en"]);
  });
});

describe("resolvePublishingLocales", () => {
  it("returns the literal list when --languages is set", async () => {
    const out = await resolvePublishingLocales(noopLogger, env, {
      languages: ["en-US", "fr-CA"],
    });
    expect(out).toEqual(["en-US", "fr-CA"]);
    expect(mockListSites).not.toHaveBeenCalled();
    expect(mockListLanguages).not.toHaveBeenCalled();
  });

  it("auto-resolves tenant-wide when no flag is set (Publishing API has no implicit default)", async () => {
    mockListLanguages.mockResolvedValue([{ name: "en" }, { name: "de" }]);
    const out = await resolvePublishingLocales(noopLogger, env, {});
    expect(out).toEqual(["en", "de"]);
    expect(mockListLanguages).toHaveBeenCalled();
  });

  it("returns [] with a warning when auto-resolve finds zero tenant languages (misconfigured env)", async () => {
    mockListLanguages.mockResolvedValue([]);
    const out = await resolvePublishingLocales(noopLogger, env, {});
    expect(out).toEqual([]);
  });

  it("resolves from a site when --languages-from-site is set", async () => {
    mockListSites.mockResolvedValue([{ name: "marketing", languages: ["en", "de"] }]);
    const out = await resolvePublishingLocales(noopLogger, env, {
      languagesFromSite: "marketing",
    });
    expect(out).toEqual(["en", "de"]);
  });

  it("resolves tenant-wide when --all-tenant-languages is set", async () => {
    mockListLanguages.mockResolvedValue([{ name: "en" }, { name: "fr" }]);
    const out = await resolvePublishingLocales(noopLogger, env, {
      allTenantLanguages: true,
    });
    expect(out).toEqual(["en", "fr"]);
  });

  it("rejects when --languages AND --languages-from-site are both set", async () => {
    await expect(
      resolvePublishingLocales(noopLogger, env, {
        languages: ["en"],
        languagesFromSite: "marketing",
      })
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("over-specified"),
    });
  });

  it("rejects when --languages-from-site AND --all-tenant-languages are both set", async () => {
    await expect(
      resolvePublishingLocales(noopLogger, env, {
        languagesFromSite: "marketing",
        allTenantLanguages: true,
      })
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("over-specified"),
    });
  });

  it("rejects when --languages-from-site resolves to an empty list", async () => {
    mockListSites.mockResolvedValue([{ name: "marketing", languages: [] }]);
    await expect(
      resolvePublishingLocales(noopLogger, env, { languagesFromSite: "marketing" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects when --all-tenant-languages resolves to an empty list", async () => {
    mockListLanguages.mockResolvedValue([]);
    await expect(
      resolvePublishingLocales(noopLogger, env, { allTenantLanguages: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
