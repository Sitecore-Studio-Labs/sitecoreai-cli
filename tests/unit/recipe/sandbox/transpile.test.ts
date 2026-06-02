import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `transpileRecipe` is a thin esbuild wrapper. Three branches to cover:
 *  1. happy path — esbuild emits a single CJS string
 *  2. esbuild throws — wrapped in INPUT_INVALID with the recipe path + a hint
 *  3. esbuild succeeds but produces no output text — also INPUT_INVALID
 */

const esbuildMocks = vi.hoisted(() => ({
  build: vi.fn(),
}));

vi.mock("esbuild", () => ({
  build: esbuildMocks.build,
}));

import { transpileRecipe } from "../../../../src/recipe/sandbox/transpile";

let tmpDir: string;
let recipePath: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scai-transpile-test-"));
  recipePath = path.join(tmpDir, "hello.recipe.ts");
  await fs.promises.writeFile(recipePath, "export const recipe = {};");
  esbuildMocks.build.mockReset();
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("transpileRecipe", () => {
  it("returns the CJS bundle text on a successful esbuild run", async () => {
    esbuildMocks.build.mockResolvedValue({
      outputFiles: [{ text: "module.exports = {};\n" }],
    });
    const out = await transpileRecipe(recipePath);
    expect(out).toBe("module.exports = {};\n");
    // Verifies the call shape — bundle + cjs + node + sourcemap inline.
    expect(esbuildMocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoints: [recipePath],
        bundle: true,
        format: "cjs",
        platform: "node",
        sourcemap: "inline",
        write: false,
      })
    );
  });

  it("wraps an esbuild error as INPUT_INVALID with the recipe path + a remediation hint", async () => {
    esbuildMocks.build.mockRejectedValue(new Error("Could not resolve './missing'"));
    await expect(transpileRecipe(recipePath)).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining(recipePath),
    });
    await expect(transpileRecipe(recipePath)).rejects.toThrow(/Failed to compile recipe/);
  });

  it("wraps a non-Error rejection by stringifying it", async () => {
    esbuildMocks.build.mockRejectedValue("plain string failure");
    await expect(transpileRecipe(recipePath)).rejects.toThrow(/plain string failure/);
  });

  it("throws INPUT_INVALID when esbuild succeeds but emits no output text (defensive)", async () => {
    esbuildMocks.build.mockResolvedValue({ outputFiles: [] });
    await expect(transpileRecipe(recipePath)).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("produced no compiled output"),
    });
  });

  it("throws INPUT_INVALID when outputFiles is undefined entirely", async () => {
    esbuildMocks.build.mockResolvedValue({});
    await expect(transpileRecipe(recipePath)).rejects.toThrow(/produced no compiled output/);
  });
});
