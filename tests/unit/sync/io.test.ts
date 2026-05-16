import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { loadRecipe, writeRecipe } from "../../../src/sync/io";

const schema = z.object({ name: z.string(), tags: z.array(z.string()).default([]) });

const withTempDir = (run: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "scai-io-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("writeRecipe + loadRecipe", () => {
  it("round-trips a recipe through YAML", () => {
    withTempDir((dir) => {
      const file = join(dir, "demo.yaml");
      writeRecipe(file, { name: "Acme", tags: ["a", "b"] });
      expect(loadRecipe(file, schema)).toEqual({ name: "Acme", tags: ["a", "b"] });
    });
  });

  it("round-trips through JSON when the path ends .json", () => {
    withTempDir((dir) => {
      const file = join(dir, "demo.json");
      writeRecipe(file, { name: "Acme", tags: [] });
      expect(loadRecipe(file, schema)).toEqual({ name: "Acme", tags: [] });
    });
  });

  it("throws for a missing file", () => {
    expect(() => loadRecipe("/no/such/scai-recipe.yaml", schema)).toThrow(/Cannot read/i);
  });

  it("throws with validation detail when the recipe fails the schema", () => {
    withTempDir((dir) => {
      const file = join(dir, "bad.yaml");
      writeRecipe(file, { tags: "not-an-array" });
      expect(() => loadRecipe(file, schema)).toThrow(/failed schema validation/i);
    });
  });
});
