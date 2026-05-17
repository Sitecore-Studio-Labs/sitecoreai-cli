import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultIrPath,
  defaultPlanPath,
  loadIr,
  loadRecipe,
  writeIr,
  writePlan,
} from "../../../src/recipe/io";
import type { OperationIr } from "../../../src/recipe/ir/operations";

/**
 * `recipe/io.ts` is plain JSON file I/O + Zod parse. These tests use a
 * real temp directory — the module touches the filesystem directly and
 * mocking `fs` would test the mock, not the path/ENOENT/JSON-parse
 * branches that actually matter.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-io-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const write = async (name: string, contents: string): Promise<string> => {
  const file = path.join(dir, name);
  await fs.writeFile(file, contents, "utf8");
  return file;
};

const VALID_RECIPE = {
  kind: "content-template",
  schemaVersion: "1",
  handle: "logo-template@1",
  name: "LogoTemplate",
  displayName: "Logo Template",
  fields: [],
};

const VALID_IR: OperationIr = {
  schemaVersion: "1",
  recipeHandle: "logo-template@1",
  operations: [],
};

describe("loadRecipe — .recipe.json path", () => {
  it("parses a well-formed recipe JSON file into a Recipe", async () => {
    const file = await write("logo.recipe.json", JSON.stringify(VALID_RECIPE));
    const recipe = await loadRecipe(file);
    expect(recipe).toMatchObject({ kind: "content-template", handle: "logo-template@1" });
  });

  it("throws INPUT_INVALID for a missing file (ENOENT)", async () => {
    await expect(loadRecipe(path.join(dir, "nope.recipe.json"))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID for a file containing invalid JSON", async () => {
    const file = await write("bad.recipe.json", "{ not json ]");
    await expect(loadRecipe(file)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when the JSON parses but fails RecipeSchema", async () => {
    const file = await write("wrong.recipe.json", JSON.stringify({ kind: "not-a-real-kind" }));
    await expect(loadRecipe(file)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("loadRecipe — .recipe.ts in-process path (SITECOREAI_RECIPE_SANDBOX=0)", () => {
  const prevSandbox = process.env.SITECOREAI_RECIPE_SANDBOX;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.SITECOREAI_RECIPE_SANDBOX = "0";
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    if (prevSandbox === undefined) delete process.env.SITECOREAI_RECIPE_SANDBOX;
    else process.env.SITECOREAI_RECIPE_SANDBOX = prevSandbox;
    stderr.mockRestore();
  });

  it("loads a recipe exported as the default export and warns about the disabled sandbox", async () => {
    const file = await write(
      "default-export.recipe.ts",
      `export default ${JSON.stringify(VALID_RECIPE)};`
    );
    const recipe = await loadRecipe(file);
    expect(recipe).toMatchObject({ handle: "logo-template@1" });
    // The opt-out warning lands on stderr.
    expect(
      stderr.mock.calls.some((c) => String(c[0]).includes("SITECOREAI_RECIPE_SANDBOX=0"))
    ).toBe(true);
  });

  it("falls back to the first named export when there is no default", async () => {
    const file = await write(
      "named-export.recipe.ts",
      `export const recipe = ${JSON.stringify(VALID_RECIPE)};`
    );
    const recipe = await loadRecipe(file);
    expect(recipe).toMatchObject({ handle: "logo-template@1" });
  });

  it("throws INPUT_INVALID for a .recipe.ts with no exports", async () => {
    const file = await write("empty.recipe.ts", "const unused = 1; void unused;");
    await expect(loadRecipe(file)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("writeIr / loadIr round-trip", () => {
  it("writeIr then loadIr returns an equal IR document", async () => {
    const file = path.join(dir, ".scai", "logo.ir.json");
    await writeIr(file, VALID_IR);
    expect(await loadIr(file)).toEqual(VALID_IR);
  });

  it("writeIr creates the parent directory when it does not exist", async () => {
    const file = path.join(dir, "nested", "deep", "x.ir.json");
    await writeIr(file, VALID_IR);
    await expect(fs.stat(file)).resolves.toBeDefined();
  });

  it("loadIr throws INPUT_INVALID when the document fails OperationIrSchema", async () => {
    const file = await write("broken.ir.json", JSON.stringify({ schemaVersion: "9" }));
    await expect(loadIr(file)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("loadIr throws INPUT_INVALID for a missing IR file", async () => {
    await expect(loadIr(path.join(dir, "ghost.ir.json"))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("writePlan", () => {
  it("serializes the plan as pretty JSON ending with a trailing newline", async () => {
    const file = path.join(dir, ".scai", "logo.plan.json");
    await writePlan(file, { schemaVersion: "1", recipeHandle: "logo-template@1" } as never);
    const raw = await fs.readFile(file, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toMatchObject({ recipeHandle: "logo-template@1" });
  });
});

describe("defaultIrPath / defaultPlanPath", () => {
  it("places the IR under <baseDir>/.scai with an .ir.json extension", () => {
    expect(defaultIrPath("logo-template@1", "/tmp/proj")).toBe(
      path.join("/tmp/proj", ".scai", "logo-template_v1.ir.json")
    );
  });

  it("places the plan under <baseDir>/.scai with a .plan.json extension", () => {
    expect(defaultPlanPath("logo-template@1", "/tmp/proj")).toBe(
      path.join("/tmp/proj", ".scai", "logo-template_v1.plan.json")
    );
  });

  it("slugifies the @ version marker to `_v` so the filename is path-safe", () => {
    expect(defaultIrPath("hero@2", "/base")).toContain("hero_v2.ir.json");
  });
});
