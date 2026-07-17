import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recipeSetNeedsRoots,
  resolveCompiledIrInputs,
  resolveRecipeRoots,
  resolveSeedSite,
} from "../../../../src/recipe/tasks/shared";

describe("recipeSetNeedsRoots", () => {
  it("is false for a workflow-only set", () => {
    expect(recipeSetNeedsRoots([{ kind: "workflow" }])).toBe(false);
  });

  it("is false for a workflow + webhook-authorization set", () => {
    expect(recipeSetNeedsRoots([{ kind: "workflow" }, { kind: "webhook-authorization" }])).toBe(
      false
    );
  });

  it("is false for an empty set (IR-only push)", () => {
    expect(recipeSetNeedsRoots([])).toBe(false);
  });

  it("is true when the set has a component-template recipe", () => {
    expect(recipeSetNeedsRoots([{ kind: "component-template" }])).toBe(true);
  });

  it("is true for a set mixing a rootless and a root-needing kind", () => {
    expect(recipeSetNeedsRoots([{ kind: "workflow" }, { kind: "component-template" }])).toBe(true);
  });
});

describe("resolveCompiledIrInputs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-from-compiled-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("resolves .ir.json files flat in the directory, sorted and absolute", async () => {
    await fs.writeFile(path.join(dir, "b.ir.json"), "{}", "utf8");
    await fs.writeFile(path.join(dir, "a.ir.json"), "{}", "utf8");
    // A non-IR sibling must be ignored — only `.ir.json` is an artifact.
    await fs.writeFile(path.join(dir, "notes.json"), "{}", "utf8");

    const { files, source } = await resolveCompiledIrInputs(dir);

    expect(source).toBe("input-flag");
    expect(files).toEqual([path.join(dir, "a.ir.json"), path.join(dir, "b.ir.json")]);
  });

  it("recurses into nested .scai/ subdirectories (compile's default layout)", async () => {
    const scai = path.join(dir, ".scai");
    await fs.mkdir(scai, { recursive: true });
    await fs.writeFile(path.join(scai, "header_v1.ir.json"), "{}", "utf8");

    const { files } = await resolveCompiledIrInputs(dir);

    expect(files).toEqual([path.join(scai, "header_v1.ir.json")]);
  });

  it("throws INPUT_INVALID with a compile hint when the directory holds no IR", async () => {
    await expect(resolveCompiledIrInputs(dir)).rejects.toThrow(/no \.ir\.json files/);
    // The remediation (produce the artifact via `recipe compile --output-dir`)
    // rides on the error's `hint`, not its message.
    const error = await resolveCompiledIrInputs(dir).catch((e: unknown) => e);
    expect((error as { hint?: string }).hint).toMatch(/recipe compile --output-dir/);
  });
});

describe("resolveRecipeRoots", () => {
  const envWithRoots = { templatesRoot: "/t", renderingsRoot: "/r" };

  it("returns configured roots from the env profile", () => {
    expect(resolveRecipeRoots({}, envWithRoots, "sandbox")).toEqual({
      templatesRoot: "/t",
      renderingsRoot: "/r",
    });
  });

  it("prefers CLI-flag overrides over the env profile", () => {
    expect(resolveRecipeRoots({ templatesRoot: "/flag-t" }, envWithRoots, "sandbox")).toEqual({
      templatesRoot: "/flag-t",
      renderingsRoot: "/r",
    });
  });

  it("throws INPUT_INVALID when required and a root is missing", () => {
    expect(() => resolveRecipeRoots({}, {}, "sandbox")).toThrowError(/Recipe parent path missing/);
  });

  it("does not throw when not required — missing roots resolve to empty strings", () => {
    expect(resolveRecipeRoots({}, {}, "sandbox", false)).toEqual({
      templatesRoot: "",
      renderingsRoot: "",
    });
  });

  it("still passes through configured roots when not required", () => {
    expect(resolveRecipeRoots({}, envWithRoots, "sandbox", false)).toEqual({
      templatesRoot: "/t",
      renderingsRoot: "/r",
    });
  });
});

describe("resolveSeedSite", () => {
  it("returns undefined when there is no env profile", () => {
    expect(resolveSeedSite(undefined)).toBeUndefined();
  });

  it("returns undefined when siteScopedGuids is unset — legacy 'default' seed", () => {
    // A profile may carry `site` purely for recipeRoots derivation. That alone
    // must NOT scope GUIDs, or every existing 'default'-seeded tenant re-keys.
    expect(resolveSeedSite({ site: "siteA" })).toBeUndefined();
  });

  it("returns undefined when siteScopedGuids is explicitly false", () => {
    expect(resolveSeedSite({ site: "siteA", siteScopedGuids: false })).toBeUndefined();
  });

  it("returns the trimmed site when siteScopedGuids is true", () => {
    expect(resolveSeedSite({ site: "  siteA  ", siteScopedGuids: true })).toBe("siteA");
  });

  it("throws INPUT_INVALID when scoping is enabled but no site is configured", () => {
    expect(() => resolveSeedSite({ siteScopedGuids: true })).toThrowError(
      /siteScopedGuids is enabled/
    );
  });

  it("throws when scoping is enabled but site is blank", () => {
    expect(() => resolveSeedSite({ siteScopedGuids: true, site: "   " })).toThrowError(
      /siteScopedGuids is enabled/
    );
  });
});
