import { describe, expect, it, vi } from "vitest";
import type { DiscoveredSite } from "../../../src/authoring";
import { alignMediaLibraryRootWithSite } from "../../../src/recipe/tasks/media-root";

/**
 * `alignMediaLibraryRootWithSite` — consolidates recipe media into the
 * site's SXA-scaffolded media folder (named after the site's DISPLAY
 * name) when it exists, instead of creating a parallel slug-named
 * sibling. Best-effort: any failure or non-match leaves the configured
 * root untouched.
 */

const logger = { info: vi.fn(), debug: vi.fn() };

const site = (overrides: Partial<DiscoveredSite>): DiscoveredSite => ({
  name: "duke-energy",
  displayName: "Duke Energy",
  path: "/sitecore/content/duke/duke-energy",
  tenantName: "duke",
  tenantPath: "/sitecore/content/duke",
  ...overrides,
});

const ROOT = "/sitecore/media library/Project/duke/duke-energy";
const SCAFFOLDED = "/sitecore/media library/Project/duke/Duke Energy";

const existing = (...paths: string[]) =>
  vi.fn(async (requested: readonly string[]) => {
    const map = new Map<string, unknown | null>();
    for (const p of requested) map.set(p, paths.includes(p) ? { itemId: "x" } : null);
    return map;
  });

describe("alignMediaLibraryRootWithSite", () => {
  it("uses the scaffolded display-name folder when it exists", async () => {
    const result = await alignMediaLibraryRootWithSite({
      configuredRoot: ROOT,
      site: "duke-energy",
      discover: async () => [site({})],
      getItemsByPaths: existing(SCAFFOLDED),
      logger,
    });
    expect(result).toBe(SCAFFOLDED);
  });

  it("keeps the configured root when the scaffolded folder does not exist", async () => {
    const result = await alignMediaLibraryRootWithSite({
      configuredRoot: ROOT,
      site: "duke-energy",
      discover: async () => [site({})],
      getItemsByPaths: existing(),
      logger,
    });
    expect(result).toBe(ROOT);
  });

  it("leaves operator-customized roots alone (leaf does not match the site)", async () => {
    const discover = vi.fn(async () => [site({})]);
    const result = await alignMediaLibraryRootWithSite({
      configuredRoot: "/sitecore/media library/Project/duke/Brand Assets",
      site: "duke-energy",
      discover,
      getItemsByPaths: existing(SCAFFOLDED),
      logger,
    });
    expect(result).toBe("/sitecore/media library/Project/duke/Brand Assets");
    // Short-circuits before any tenant lookups.
    expect(discover).not.toHaveBeenCalled();
  });

  it("is a no-op when the display name equals the leaf", async () => {
    const lookups = existing();
    const result = await alignMediaLibraryRootWithSite({
      configuredRoot: ROOT,
      site: "duke-energy",
      discover: async () => [site({ displayName: "duke-energy" })],
      getItemsByPaths: lookups,
      logger,
    });
    expect(result).toBe(ROOT);
    expect(lookups).not.toHaveBeenCalled();
  });

  it("returns the configured root when the site is not discovered", async () => {
    const result = await alignMediaLibraryRootWithSite({
      configuredRoot: ROOT,
      site: "duke-energy",
      discover: async () => [site({ name: "other-site", displayName: "Other" })],
      getItemsByPaths: existing(SCAFFOLDED),
      logger,
    });
    expect(result).toBe(ROOT);
  });

  it("fails open on discovery errors", async () => {
    const result = await alignMediaLibraryRootWithSite({
      configuredRoot: ROOT,
      site: "duke-energy",
      discover: async () => {
        throw new Error("auth expired");
      },
      getItemsByPaths: existing(SCAFFOLDED),
      logger,
    });
    expect(result).toBe(ROOT);
  });

  it("passes through undefined root / missing site untouched", async () => {
    const discover = vi.fn(async () => [site({})]);
    await expect(
      alignMediaLibraryRootWithSite({
        configuredRoot: undefined,
        site: "duke-energy",
        discover,
        getItemsByPaths: existing(),
        logger,
      })
    ).resolves.toBeUndefined();
    await expect(
      alignMediaLibraryRootWithSite({
        configuredRoot: ROOT,
        site: undefined,
        discover,
        getItemsByPaths: existing(),
        logger,
      })
    ).resolves.toBe(ROOT);
    expect(discover).not.toHaveBeenCalled();
  });
});
