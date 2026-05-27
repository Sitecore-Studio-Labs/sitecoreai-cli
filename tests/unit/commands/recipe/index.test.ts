import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai … recipe …` command wiring. The recipe task runners are mocked;
 * the structural block walks the command tree, and the delegation block
 * parses the commander tree the way the CLI does and asserts each
 * runner's call args — option parsing/coercion (`--plan-concurrency`
 * argParser, recipe-root flags), the required-vs-optional `--input`
 * gate, and the `runRecipePush` failure → `DEPLOY_FAILED` surfacing.
 */

const taskMocks = vi.hoisted(() => ({
  runRecipeCompile: vi.fn(),
  runRecipeDiff: vi.fn(),
  runRecipePlan: vi.fn(),
  runRecipePush: vi.fn(),
  runRecipePruneDefaults: vi.fn(),
}));

vi.mock("../../../../src/recipe/tasks/compile", () => ({
  runRecipeCompile: taskMocks.runRecipeCompile,
}));
vi.mock("../../../../src/recipe/tasks/diff", () => ({ runRecipeDiff: taskMocks.runRecipeDiff }));
vi.mock("../../../../src/recipe/tasks/plan", () => ({ runRecipePlan: taskMocks.runRecipePlan }));
vi.mock("../../../../src/recipe/tasks/push", () => ({ runRecipePush: taskMocks.runRecipePush }));
vi.mock("../../../../src/recipe/tasks/prune-defaults", () => ({
  runRecipePruneDefaults: taskMocks.runRecipePruneDefaults,
}));

import { createRecipeCommand } from "../../../../src/commands/recipe";

const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const subNames = (command: Command): string[] => command.commands.map((child) => child.name());

const hasOption = (command: Command, long: string): boolean =>
  command.options.some((option) => option.long === long);

describe("createRecipeCommand — structure", () => {
  const recipe = createRecipeCommand();

  it("exposes compile / diff / plan / push / prune-defaults", () => {
    expect(subNames(recipe)).toEqual(
      expect.arrayContaining(["compile", "diff", "plan", "push", "prune-defaults"])
    );
  });

  it("gives `compile` the recipe-root + output options", () => {
    const compile = sub(recipe, "compile")!;
    for (const opt of [
      "--templates-root",
      "--renderings-root",
      "--components-root",
      "--content-models-root",
      "--partial-designs-root",
      "--page-designs-root",
      "--content-items-root",
      "--output",
      "--input",
    ]) {
      expect(hasOption(compile, opt), `compile missing ${opt}`).toBe(true);
    }
  });

  it("gives `push` the write-side options (--what-if, --allow-write, --skip-unchanged-recipes, --plan-concurrency)", () => {
    const push = sub(recipe, "push")!;
    for (const opt of [
      "--what-if",
      "--allow-write",
      "--skip-unchanged-recipes",
      "--plan-concurrency",
    ]) {
      expect(hasOption(push, opt), `push missing ${opt}`).toBe(true);
    }
  });

  it("makes `--input` mandatory on `plan` but optional on `compile`/`diff`/`push`", () => {
    const planInput = sub(recipe, "plan")!.options.find((o) => o.long === "--input");
    expect(planInput?.mandatory).toBe(true);
    for (const name of ["compile", "diff", "push"]) {
      const input = sub(recipe, name)!.options.find((o) => o.long === "--input");
      expect(input?.mandatory, `${name} --input`).toBe(false);
    }
  });

  it("keeps `compile`/`diff`/`plan` free of write-side options", () => {
    for (const name of ["compile", "diff", "plan"]) {
      expect(hasOption(sub(recipe, name)!, "--allow-write"), name).toBe(false);
    }
  });
});

describe("createRecipeCommand — action delegation", () => {
  const runRecipe = async (args: string[]): Promise<void> => {
    const command = createRecipeCommand();
    command.exitOverride();
    await command.parseAsync(["node", "scai", ...args]);
  };

  beforeEach(() => {
    for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
    taskMocks.runRecipeDiff.mockResolvedValue([]);
    taskMocks.runRecipePush.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates `compile` and threads --input + recipe-root flags", async () => {
    await runRecipe([
      "compile",
      "-i",
      "cta.recipe.ts",
      "--templates-root",
      "/sitecore/templates/X",
      "--renderings-root",
      "/sitecore/layout/X",
      "--quiet",
    ]);
    expect(taskMocks.runRecipeCompile).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "cta.recipe.ts",
        templatesRoot: "/sitecore/templates/X",
        renderingsRoot: "/sitecore/layout/X",
      })
    );
  });

  it("delegates `plan` with the required --input", async () => {
    taskMocks.runRecipePlan.mockResolvedValue({} as never);
    await runRecipe(["plan", "-i", "cta.ir.json", "--quiet"]);
    expect(taskMocks.runRecipePlan).toHaveBeenCalledWith(
      expect.objectContaining({ input: "cta.ir.json" })
    );
  });

  it("throws a commander error when `plan` is missing the required --input", async () => {
    await expect(runRecipe(["plan", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runRecipePlan).not.toHaveBeenCalled();
  });

  it("delegates `diff` (optional --input may be omitted)", async () => {
    await runRecipe(["diff", "--quiet"]);
    expect(taskMocks.runRecipeDiff).toHaveBeenCalledOnce();
  });

  it("delegates `prune-defaults` with its override roots", async () => {
    await runRecipe([
      "prune-defaults",
      "--headless-variants-root",
      "/X/HV",
      "--available-renderings-root",
      "/X/AR",
      "--presentation-styles-root",
      "/X/Styles",
      "--quiet",
    ]);
    expect(taskMocks.runRecipePruneDefaults).toHaveBeenCalledWith(
      expect.objectContaining({
        headlessVariantsRoot: "/X/HV",
        availableRenderingsRoot: "/X/AR",
        presentationStylesRoot: "/X/Styles",
      })
    );
  });

  it("coerces a valid --plan-concurrency to a number", async () => {
    await runRecipe(["push", "--plan-concurrency", "8", "--quiet"]);
    expect(taskMocks.runRecipePush).toHaveBeenCalledWith(
      expect.objectContaining({ planConcurrency: 8 })
    );
  });

  it("rejects a non-numeric --plan-concurrency via the argParser", async () => {
    await expect(
      runRecipe(["push", "--plan-concurrency", "zero", "--quiet"])
    ).rejects.toBeDefined();
    expect(taskMocks.runRecipePush).not.toHaveBeenCalled();
  });

  it("rejects a zero/negative --plan-concurrency via the argParser", async () => {
    await expect(runRecipe(["push", "--plan-concurrency", "0", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runRecipePush).not.toHaveBeenCalled();
  });

  it("forwards --skip-unchanged-recipes and --allow-write to runRecipePush", async () => {
    await runRecipe(["push", "--skip-unchanged-recipes", "--allow-write", "--quiet"]);
    expect(taskMocks.runRecipePush).toHaveBeenCalledWith(
      expect.objectContaining({ skipUnchangedRecipes: true, allowWrite: true })
    );
  });

  it("exits clean when every pushed recipe succeeds", async () => {
    taskMocks.runRecipePush.mockResolvedValue([
      { plan: { recipeHandle: "cta", actions: [] }, summary: { error: 0 }, aborted: false },
    ] as never);
    await expect(runRecipe(["push", "--quiet"])).resolves.toBeUndefined();
  });

  it("surfaces DEPLOY_FAILED when a pushed recipe aborts", async () => {
    taskMocks.runRecipePush.mockResolvedValue([
      {
        plan: {
          recipeHandle: "cta-button",
          actions: [
            {
              operation: { label: "CreateItem cta-button" },
              reason: "parent ref unresolved",
              mutation: { kind: "create" },
            },
          ],
        },
        summary: { error: 1 },
        aborted: true,
      },
    ] as never);

    await expect(runRecipe(["push", "--quiet"])).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
    });
  });

  it("surfaces DEPLOY_FAILED when a recipe reports op errors without aborting", async () => {
    taskMocks.runRecipePush.mockResolvedValue([
      { plan: { recipeHandle: "cta", actions: [] }, summary: { error: 2 }, aborted: false },
    ] as never);

    await expect(runRecipe(["push", "--quiet"])).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
    });
  });

  it("includes the rollback summary in the DEPLOY_FAILED details for an aborted recipe with rollback", async () => {
    taskMocks.runRecipePush.mockResolvedValue([
      {
        plan: {
          recipeHandle: "cta-button",
          actions: [
            { operation: { label: "CreateItem A" }, mutation: { kind: "create" } },
            { operation: { label: "CreateItem B" }, reason: "boom", mutation: { kind: "create" } },
          ],
        },
        summary: { error: 1 },
        aborted: true,
        rollback: { rolledBack: 1 },
      },
    ] as never);

    await expect(runRecipe(["push", "--quiet"])).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
      details: expect.arrayContaining([expect.stringContaining("rolled back 1 of")]),
    });
  });

  it("handles an aborted recipe whose plan has no actions (unknown op label)", async () => {
    taskMocks.runRecipePush.mockResolvedValue([
      { plan: { recipeHandle: "empty", actions: [] }, summary: { error: 0 }, aborted: true },
    ] as never);

    await expect(runRecipe(["push", "--quiet"])).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
      details: expect.arrayContaining([expect.stringContaining("(unknown op)")]),
    });
  });
});
