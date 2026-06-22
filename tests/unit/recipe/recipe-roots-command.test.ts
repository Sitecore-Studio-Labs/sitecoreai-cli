import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import { resolveDerivedRoots } from "../../../src/recipe/tasks/roots";

const SITE = "demo-registry";
const COLLECTION = "showcase";
const TEMPLATES = "/sitecore/templates/Project/showcase/demo-registry/Components";

const discoverOk = async () => [{ name: SITE, tenantName: COLLECTION }];

describe("resolveDerivedRoots", () => {
  it("derives from explicit site + collection without discovery", async () => {
    const discover = vi.fn(discoverOk);
    const result = await resolveDerivedRoots(
      { site: SITE, siteCollection: COLLECTION, environment: undefined, envName: "dev" },
      discover
    );
    expect(result).toMatchObject({ site: SITE, siteCollection: COLLECTION });
    expect(result.recipeRoots.templates).toBe(TEMPLATES);
    expect(discover).not.toHaveBeenCalled();
  });

  it("falls back to the env profile's site + collection", async () => {
    const env: EnvironmentConfiguration = { site: SITE, siteCollection: COLLECTION };
    const discover = vi.fn(discoverOk);
    const result = await resolveDerivedRoots({ environment: env, envName: "dev" }, discover);
    expect(result.recipeRoots.templates).toBe(TEMPLATES);
    expect(discover).not.toHaveBeenCalled();
  });

  it("lets explicit flags override the env profile", async () => {
    const env: EnvironmentConfiguration = { site: "other", siteCollection: "other-col" };
    const result = await resolveDerivedRoots(
      { site: SITE, siteCollection: COLLECTION, environment: env, envName: "dev" },
      vi.fn(discoverOk)
    );
    expect(result).toMatchObject({ site: SITE, siteCollection: COLLECTION });
  });

  it("discovers the collection when site is set but collection is absent", async () => {
    const env: EnvironmentConfiguration = { site: SITE, host: "x" };
    const discover = vi.fn(discoverOk);
    const result = await resolveDerivedRoots({ environment: env, envName: "dev" }, discover);
    expect(result.siteCollection).toBe(COLLECTION);
    expect(discover).toHaveBeenCalledOnce();
  });

  it("throws when no site is available", async () => {
    await expect(
      resolveDerivedRoots({ environment: undefined, envName: "dev" }, vi.fn(discoverOk))
    ).rejects.toThrowError(/No site/);
  });

  it("throws when a collection must be discovered but there is no environment", async () => {
    await expect(
      resolveDerivedRoots({ site: SITE, environment: undefined, envName: "dev" }, vi.fn(discoverOk))
    ).rejects.toThrowError(/without an environment/);
  });

  it("throws when discovery finds no matching site", async () => {
    const env: EnvironmentConfiguration = { site: "ghost", host: "x" };
    await expect(
      resolveDerivedRoots({ environment: env, envName: "dev" }, discoverOk)
    ).rejects.toThrowError(/no site named 'ghost'/);
  });
});
