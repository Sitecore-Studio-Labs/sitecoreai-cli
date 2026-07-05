import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadImageDefaults } from "../../../src/recipe/tasks/shared";

/**
 * `loadImageDefaults` resolves the brand image-defaults map for a
 * compile/push: `--image-defaults <path>` flag → `SITECOREAI_IMAGE_DEFAULTS`
 * env var (also a path) → undefined. The file is a flat JSON object of
 * role → fully-qualified http(s) URL; anything else fails fast with
 * INPUT_INVALID before tenant work starts.
 */

let dir: string;
const originalEnv = process.env.SITECOREAI_IMAGE_DEFAULTS;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-image-defaults-"));
  delete process.env.SITECOREAI_IMAGE_DEFAULTS;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.SITECOREAI_IMAGE_DEFAULTS;
  else process.env.SITECOREAI_IMAGE_DEFAULTS = originalEnv;
});

const writeMap = async (content: unknown): Promise<string> => {
  const file = path.join(dir, "image-defaults.json");
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
};

describe("loadImageDefaults", () => {
  it("returns undefined when neither flag nor env var is set", async () => {
    expect(await loadImageDefaults(undefined)).toBeUndefined();
  });

  it("loads a valid role → URL map from the flag path", async () => {
    const file = await writeMap({
      avatar: "https://assets.example.invalid/avatar.png",
      hero: "https://assets.example.invalid/hero.jpg",
    });
    expect(await loadImageDefaults(file)).toEqual({
      avatar: "https://assets.example.invalid/avatar.png",
      hero: "https://assets.example.invalid/hero.jpg",
    });
  });

  it("falls back to SITECOREAI_IMAGE_DEFAULTS when no flag is passed", async () => {
    const file = await writeMap({ avatar: "https://assets.example.invalid/avatar.png" });
    process.env.SITECOREAI_IMAGE_DEFAULTS = file;
    expect(await loadImageDefaults(undefined)).toEqual({
      avatar: "https://assets.example.invalid/avatar.png",
    });
  });

  it("returns undefined for an empty map (no roles → nothing to substitute)", async () => {
    const file = await writeMap({});
    expect(await loadImageDefaults(file)).toBeUndefined();
  });

  it("throws INPUT_INVALID for an unreadable path", async () => {
    await expect(loadImageDefaults(path.join(dir, "missing.json"))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID for invalid JSON", async () => {
    const file = await writeMap("{not json");
    await expect(loadImageDefaults(file)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID for a non-object payload", async () => {
    const file = await writeMap(["https://assets.example.invalid/a.png"]);
    await expect(loadImageDefaults(file)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID for a non-URL value", async () => {
    const file = await writeMap({ avatar: "/sitecore/media library/Not/A/Url" });
    await expect(loadImageDefaults(file)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
