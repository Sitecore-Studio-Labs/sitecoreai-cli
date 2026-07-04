import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import {
  ensureSiteCollection,
  resolveRecipeRoots,
  withDerivedRecipeRoots,
} from "../../../src/recipe/tasks/shared";

const SITE = "demo-registry";
const COLLECTION = "showcase";

const TEMPLATES = "/sitecore/templates/Project/showcase/demo-registry/Components";
const RENDERINGS = "/sitecore/layout/Renderings/Project/showcase/demo-registry/Components";

const withSite = (extra: Partial<EnvironmentConfiguration> = {}): EnvironmentConfiguration => ({
  site: SITE,
  siteCollection: COLLECTION,
  ...extra,
});

describe("withDerivedRecipeRoots", () => {
  it("derives every flat root from site + collection when none are set", () => {
    const env = withDerivedRecipeRoots(withSite());
    expect(env?.templatesRoot).toBe(TEMPLATES);
    expect(env?.renderingsRoot).toBe(RENDERINGS);
    expect(env?.componentsRoot).toBe(TEMPLATES);
    expect(env?.contentModelsRoot).toBe(
      "/sitecore/templates/Project/showcase/demo-registry/Content Models"
    );
    expect(env?.pageDesignsRoot).toBe(
      "/sitecore/content/showcase/demo-registry/Presentation/Page Designs"
    );
    expect(env?.enumerationsRoot).toBe(
      "/sitecore/content/showcase/demo-registry/Presentation/Enumerations"
    );
    // Media root — recipe-materialised media (external-URL image fields)
    // must land inside the SXA site's media scope, or Pages' image-field
    // picker can't resolve the mediaid to a path and shows a raw GUID.
    expect(env?.mediaLibraryRoot).toBe("/sitecore/media library/Project/showcase/demo-registry");
    expect(env?.placeholderSettingsRoots).toEqual([
      "/sitecore/content/showcase/demo-registry/Presentation/Placeholder Settings",
      "/sitecore/layout/Placeholder Settings/Project/showcase/demo-registry",
    ]);
  });

  it("keeps explicit roots and derives only the absent ones (partial override)", () => {
    const env = withDerivedRecipeRoots(withSite({ templatesRoot: "/custom/templates" }));
    expect(env?.templatesRoot).toBe("/custom/templates");
    // siblings still derived
    expect(env?.renderingsRoot).toBe(RENDERINGS);
  });

  it("returns the profile unchanged when site is absent", () => {
    const env: EnvironmentConfiguration = { siteCollection: COLLECTION };
    expect(withDerivedRecipeRoots(env)).toBe(env);
  });

  it("returns the profile unchanged when siteCollection is absent (auto-resolution is a later milestone)", () => {
    const env: EnvironmentConfiguration = { site: SITE };
    expect(withDerivedRecipeRoots(env)).toBe(env);
  });

  it("passes through undefined", () => {
    expect(withDerivedRecipeRoots(undefined)).toBeUndefined();
  });
});

describe("resolveRecipeRoots — derivation fallback", () => {
  it("resolves the required roots from site + collection without throwing", () => {
    expect(resolveRecipeRoots({}, withSite(), "dev", true)).toEqual({
      templatesRoot: TEMPLATES,
      renderingsRoot: RENDERINGS,
    });
  });

  it("lets a CLI flag override the derived root (flag > derived)", () => {
    const roots = resolveRecipeRoots({ templatesRoot: "/flag/templates" }, withSite(), "dev", true);
    expect(roots.templatesRoot).toBe("/flag/templates");
    expect(roots.renderingsRoot).toBe(RENDERINGS);
  });

  it("still throws INPUT_INVALID when neither roots nor site are configured", () => {
    expect(() => resolveRecipeRoots({}, {}, "dev", true)).toThrowError(
      /Recipe parent path missing/
    );
  });
});

describe("ensureSiteCollection", () => {
  const discoverOk = async () => [
    { name: "other-site", tenantName: "other-collection" },
    { name: SITE, tenantName: COLLECTION },
  ];

  it("resolves siteCollection from discovery when site is set and collection is absent", async () => {
    const env = await ensureSiteCollection({ site: SITE }, "dev", discoverOk);
    expect(env?.siteCollection).toBe(COLLECTION);
    expect(env?.site).toBe(SITE);
  });

  it("matches the site name case-insensitively", async () => {
    const env = await ensureSiteCollection({ site: "Demo-Registry" }, "dev", discoverOk);
    expect(env?.siteCollection).toBe(COLLECTION);
  });

  it("does not discover when siteCollection is already set", async () => {
    const discover = vi.fn(discoverOk);
    const env = { site: SITE, siteCollection: "explicit" };
    expect(await ensureSiteCollection(env, "dev", discover)).toBe(env);
    expect(discover).not.toHaveBeenCalled();
  });

  it("does not discover when site is absent", async () => {
    const discover = vi.fn(discoverOk);
    const env = { templatesRoot: "/x" };
    expect(await ensureSiteCollection(env, "dev", discover)).toBe(env);
    expect(discover).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when no site matches", async () => {
    await expect(
      ensureSiteCollection({ site: "ghost-site" }, "dev", discoverOk)
    ).rejects.toThrowError(/no site named 'ghost-site'/);
  });

  it("throws INPUT_INVALID when discovery fails", async () => {
    const discover = async () => {
      throw new Error("network down");
    };
    await expect(ensureSiteCollection({ site: SITE }, "dev", discover)).rejects.toThrowError(
      /site discovery failed/
    );
  });

  it("passes through undefined", async () => {
    expect(await ensureSiteCollection(undefined, "dev", discoverOk)).toBeUndefined();
  });
});
