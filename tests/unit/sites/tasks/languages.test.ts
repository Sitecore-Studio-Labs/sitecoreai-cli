import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/auth", () => ({ getAccessToken: vi.fn() }));
vi.mock("../../../../src/policy/allow-write", () => ({ ensureAllowWrite: vi.fn() }));
vi.mock("../../../../src/sites", () => ({
  listLanguages: vi.fn(),
  listSupportedLanguages: vi.fn(),
  addLanguage: vi.fn(),
  updateLanguage: vi.fn(),
  removeLanguage: vi.fn(),
  // Real policy so the add task's fallback wiring is exercised for real.
  fallbackLanguageIsoFor: (code: string, present: ReadonlySet<string>) => {
    const lower = code.trim().toLowerCase();
    if (!lower || lower === "en") return null;
    const dash = lower.indexOf("-");
    const base = dash === -1 ? lower : lower.slice(0, dash);
    if (base === "en") return "en";
    if (base !== lower && present.has(base)) return base;
    return "en";
  },
  // Real-ish splitter so the add task converts `fr-FR` → {languageCode, regionCode}.
  parseLanguageCode: (code: string) => {
    const dash = code.indexOf("-");
    return dash === -1
      ? { languageCode: code }
      : { languageCode: code.slice(0, dash), regionCode: code.slice(dash + 1) };
  },
}));

import { resolveEnvironment } from "../../../../src/policy/environment";
import { getAccessToken } from "../../../../src/auth";
import { ensureAllowWrite } from "../../../../src/policy/allow-write";
import {
  addLanguage,
  listLanguages,
  listSupportedLanguages,
  removeLanguage,
  updateLanguage,
} from "../../../../src/sites";
import {
  runSitesLanguageAdd,
  runSitesLanguageList,
  runSitesLanguageListSupported,
  runSitesLanguageRemove,
} from "../../../../src/sites/tasks/languages";

const base = { json: true } as const;
let stdout: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "RegistryCM",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  });
  vi.mocked(getAccessToken).mockResolvedValue("tkn");
  vi.mocked(listLanguages).mockResolvedValue([{ iso: "en" }] as never);
  vi.mocked(listSupportedLanguages).mockResolvedValue([] as never);
  vi.mocked(addLanguage).mockResolvedValue({ iso: "fr-FR" } as never);
  vi.mocked(removeLanguage).mockResolvedValue(true as never);
});

afterEach(() => {
  stdout.mockRestore();
});

describe("sites language tasks", () => {
  it("list mints a token and calls listLanguages with the resolved client", async () => {
    await runSitesLanguageList({ ...base });
    expect(vi.mocked(getAccessToken)).toHaveBeenCalled();
    expect(vi.mocked(listLanguages)).toHaveBeenCalledWith({ accessToken: "tkn" });
  });

  it("list-supported calls listSupportedLanguages", async () => {
    await runSitesLanguageListSupported({ ...base });
    expect(vi.mocked(listSupportedLanguages)).toHaveBeenCalledWith({ accessToken: "tkn" });
  });

  it("add requires --code", async () => {
    await expect(runSitesLanguageAdd({ ...base })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(addLanguage)).not.toHaveBeenCalled();
  });

  it("add enforces allow-write and posts the split language + region code", async () => {
    await runSitesLanguageAdd({ ...base, code: "fr-FR" });
    expect(vi.mocked(ensureAllowWrite)).toHaveBeenCalled();
    // fr-FR must be split: the Sites API rejects a combined languageCode.
    expect(vi.mocked(addLanguage)).toHaveBeenCalledWith(
      { accessToken: "tkn" },
      { languageCode: "fr", regionCode: "FR" }
    );
  });

  it("add wires the new language's fallback (base present → base)", async () => {
    vi.mocked(listLanguages).mockResolvedValue([{ iso: "en" }, { iso: "fr" }] as never);
    await runSitesLanguageAdd({ ...base, code: "fr-FR" });
    expect(vi.mocked(updateLanguage)).toHaveBeenCalledWith({ accessToken: "tkn" }, "fr-FR", {
      languageCode: "fr",
      regionCode: "FR",
      fallbackLanguageIso: "fr",
    });
  });

  it("add wires the fallback to en when the base language is absent", async () => {
    vi.mocked(listLanguages).mockResolvedValue([{ iso: "en" }] as never);
    await runSitesLanguageAdd({ ...base, code: "da-DK" });
    expect(vi.mocked(updateLanguage)).toHaveBeenCalledWith({ accessToken: "tkn" }, "da-DK", {
      languageCode: "da",
      regionCode: "DK",
      fallbackLanguageIso: "en",
    });
  });

  it("a failed fallback PATCH never fails the add", async () => {
    vi.mocked(updateLanguage).mockRejectedValue(new Error("403"));
    await expect(runSitesLanguageAdd({ ...base, code: "fr-FR" })).resolves.toBeUndefined();
    expect(vi.mocked(addLanguage)).toHaveBeenCalled();
  });

  it("rm removes the language by code", async () => {
    await runSitesLanguageRemove({ ...base, code: "fr-FR" });
    expect(vi.mocked(removeLanguage)).toHaveBeenCalledWith({ accessToken: "tkn" }, "fr-FR");
  });

  it("throws AUTH_REQUIRED when no Sites API token can be minted", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(undefined);
    await expect(runSitesLanguageList({ ...base })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});
