import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/recipe/tasks/shared", () => ({
  toLogger: vi.fn(),
  resolveTenant: vi.fn(),
  resolveRecipeRoots: vi.fn(),
  recipeSetNeedsRoots: vi.fn(),
  resolveRecipeInputs: vi.fn(),
  ensureAllowWrite: vi.fn(),
}));
vi.mock("../../../../src/recipe/io", () => ({
  loadRecipe: vi.fn(),
  loadIr: vi.fn(),
}));
vi.mock("../../../../src/recipe/compile", () => ({
  compileRecipeSet: vi.fn(),
}));
vi.mock("../../../../src/recipe/runtime/execute", () => ({
  executeIr: vi.fn(),
}));
vi.mock("../../../../src/recipe/runtime/cache", () => ({
  loadRecipeCache: vi.fn(),
  cachedSkipFor: vi.fn(),
  hashIr: vi.fn(() => "ir-hash"),
  hashRoots: vi.fn(() => "roots-hash"),
  recordCacheEntry: vi.fn(),
  saveRecipeCache: vi.fn(),
}));
vi.mock("../../../../src/recipe/rollback/rollback-log", () => ({
  createRollbackLogger: vi.fn(),
}));
vi.mock("../../../../src/recipe/api/auth", () => ({
  getAccessToken: vi.fn(),
}));
vi.mock("../../../../src/recipe/api/sites-client", () => ({
  createSitesApiClient: vi.fn(() => ({ kind: "sites-client" })),
}));
vi.mock("../../../../src/recipe/tasks/placeholder-allow", () => ({
  applyPlaceholderAllowControls: vi.fn(),
}));

import { runRecipePush } from "../../../../src/recipe/tasks/push";
import * as shared from "../../../../src/recipe/tasks/shared";
import * as io from "../../../../src/recipe/io";
import { compileRecipeSet } from "../../../../src/recipe/compile";
import { executeIr } from "../../../../src/recipe/runtime/execute";
import * as cache from "../../../../src/recipe/runtime/cache";
import { createRollbackLogger } from "../../../../src/recipe/rollback/rollback-log";
import { getAccessToken } from "../../../../src/recipe/api/auth";
import { createSitesApiClient } from "../../../../src/recipe/api/sites-client";
import { applyPlaceholderAllowControls } from "../../../../src/recipe/tasks/placeholder-allow";

interface FakeLogger {
  isJson: () => boolean;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

let logger: FakeLogger;
let jsonMode: boolean;

const makeIr = (recipeHandle: string, operations: unknown[] = []) =>
  ({ schemaVersion: "1", recipeHandle, operations }) as never;

const createItemOp = (id: string, itemPath: string) => ({
  op: "CreateItem",
  id,
  path: itemPath,
  parent: { kind: "ref-path", value: `${itemPath}/..` },
  templateOf: "tpl",
});

const makeResult = (recipeHandle: string, overrides: Record<string, unknown> = {}) => {
  const summary = { create: 1, update: 0, skip: 0, error: 0 };
  return {
    plan: {
      schemaVersion: "1",
      recipeHandle,
      actions: [
        { index: 0, status: "create", operation: { label: "Create X" }, mutation: true },
        { index: 1, status: "update", operation: { label: "Set Y" }, mutation: true },
        { index: 2, status: "skip", operation: { label: "Skip Z" }, mutation: false },
      ],
      summary,
    },
    summary,
    aborted: false,
    ...overrides,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  jsonMode = false;
  logger = {
    isJson: () => jsonMode,
    info: vi.fn(),
    warn: vi.fn(),
    json: vi.fn(),
  };
  vi.mocked(shared.toLogger).mockReturnValue(logger as never);
  vi.mocked(shared.resolveTenant).mockReturnValue({
    root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
    envName: "test",
    environment: { placeholderSettingsRoots: [] },
    client: { getItemsByPaths: vi.fn().mockResolvedValue(new Map()) },
  } as never);
  vi.mocked(shared.resolveRecipeRoots).mockReturnValue({
    templatesRoot: "/t",
    renderingsRoot: "/r",
  } as never);
  vi.mocked(shared.resolveRecipeInputs).mockResolvedValue({
    files: ["hero.recipe.ts"],
    source: "config",
  } as never);
  vi.mocked(io.loadRecipe).mockResolvedValue({
    kind: "component-template",
    handle: "hero",
    name: "Hero",
  } as never);
  vi.mocked(compileRecipeSet).mockReturnValue([makeIr("hero", [createItemOp("op-1", "/t/Hero")])]);
  vi.mocked(createRollbackLogger).mockReturnValue({
    runId: "rb-run",
    logPath: "/tmp/rb/rb-run.jsonl",
    wasUsed: false,
  } as never);
  vi.mocked(cache.cachedSkipFor).mockReturnValue(undefined as never);
  vi.mocked(executeIr).mockImplementation(async (ir, _client, opts) => {
    (opts as { emit?: (e: unknown) => void }).emit?.({
      kind: "op-applied",
      action: {
        index: 0,
        status: "create",
        operation: { label: "Create X" },
        mutation: true,
      },
    });
    return makeResult((ir as { recipeHandle: string }).recipeHandle) as never;
  });
});

describe("runRecipePush — apply vs dry-run", () => {
  it("enforces the allow-write gate and executes in apply mode", async () => {
    const results = await runRecipePush({ allowWrite: true } as never);

    expect(shared.ensureAllowWrite).toHaveBeenCalledWith(
      expect.anything(),
      "test",
      true,
      "recipe-push"
    );
    expect(executeIr).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeIr).mock.calls[0][2]).toMatchObject({ mode: "apply" });
    expect(results).toHaveLength(1);
  });

  it("skips the allow-write gate and executes in plan mode for --what-if", async () => {
    await runRecipePush({ whatIf: true } as never);

    expect(shared.ensureAllowWrite).not.toHaveBeenCalled();
    expect(vi.mocked(executeIr).mock.calls[0][2]).toMatchObject({ mode: "plan" });
  });

  it("renders a per-op human summary with action tags", async () => {
    await runRecipePush({ allowWrite: true } as never);

    const lines = logger.info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("[+]"))).toBe(true);
    expect(lines.some((l) => l.includes("[~]"))).toBe(true);
    expect(lines.some((l) => l.includes("Summary: 1 create"))).toBe(true);
  });

  it("emits a JSON envelope in --json mode", async () => {
    jsonMode = true;
    await runRecipePush({ allowWrite: true } as never);

    expect(logger.json).toHaveBeenCalledTimes(1);
    const envelope = logger.json.mock.calls[0][0] as Record<string, unknown>;
    expect(envelope).toMatchObject({ command: "recipe.push", environment: "test", whatIf: false });
    expect((envelope.events as unknown[]).length).toBe(1);
  });
});

describe("runRecipePush — recipe-hash skip cache", () => {
  it("short-circuits a cached recipe without executing it", async () => {
    vi.mocked(cache.loadRecipeCache).mockResolvedValue({ entries: {} } as never);
    vi.mocked(cache.cachedSkipFor).mockReturnValue({ lastApplied: "2026-01-01" } as never);

    const results = await runRecipePush({
      allowWrite: true,
      skipUnchangedRecipes: true,
    } as never);

    expect(executeIr).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].summary).toMatchObject({ create: 0, skip: 1 });
    expect(logger.info.mock.calls.some((c) => String(c[0]).includes("Skipping hero"))).toBe(true);
  });

  it("records a cache entry after a successful apply", async () => {
    vi.mocked(cache.loadRecipeCache).mockResolvedValue({ entries: {} } as never);

    await runRecipePush({ allowWrite: true, skipUnchangedRecipes: true } as never);

    expect(cache.recordCacheEntry).toHaveBeenCalledTimes(1);
    expect(cache.saveRecipeCache).toHaveBeenCalledTimes(1);
  });

  it("does not record a cache entry when the apply aborted", async () => {
    vi.mocked(cache.loadRecipeCache).mockResolvedValue({ entries: {} } as never);
    vi.mocked(executeIr).mockResolvedValue(
      makeResult("hero", {
        aborted: true,
        summary: { create: 0, update: 0, skip: 0, error: 1 },
      }) as never
    );

    await runRecipePush({ allowWrite: true, skipUnchangedRecipes: true } as never);

    expect(cache.recordCacheEntry).not.toHaveBeenCalled();
  });
});

describe("runRecipePush — Sites API token", () => {
  it("mints a Sites API client when an IR carries a CreateSiteFromTemplate op", async () => {
    vi.mocked(compileRecipeSet).mockReturnValue([
      makeIr("site", [{ op: "CreateSiteFromTemplate", id: "s-1" }]),
    ]);
    vi.mocked(getAccessToken).mockResolvedValue("site-token" as never);

    await runRecipePush({ allowWrite: true } as never);

    expect(createSitesApiClient).toHaveBeenCalledWith({ accessToken: "site-token" });
    expect(vi.mocked(executeIr).mock.calls[0][2]).toMatchObject({
      sitesClient: { kind: "sites-client" },
    });
  });

  it("throws AUTH_REQUIRED when the Sites API token cannot be minted", async () => {
    vi.mocked(compileRecipeSet).mockReturnValue([
      makeIr("site", [{ op: "CreateSiteFromTemplate", id: "s-1" }]),
    ]);
    vi.mocked(getAccessToken).mockResolvedValue(null as never);

    await expect(runRecipePush({ allowWrite: true } as never)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

describe("runRecipePush — placeholder allow-controls post-phase", () => {
  it("registers placeholders when a component recipe declares placedIn", async () => {
    vi.mocked(io.loadRecipe).mockResolvedValue({
      kind: "component-template",
      handle: "hero",
      name: "Hero",
      placedIn: ["headless-main"],
    } as never);
    vi.mocked(shared.resolveTenant).mockReturnValue({
      root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
      envName: "test",
      environment: { placeholderSettingsRoots: ["/ph"] },
      client: { getItemsByPaths: vi.fn().mockResolvedValue(new Map()) },
    } as never);
    vi.mocked(applyPlaceholderAllowControls).mockResolvedValue({
      patched: 2,
      totalAdded: 3,
      unresolvedRecipeHandles: [],
      unmatchedPlaceholderKeys: [],
    } as never);

    await runRecipePush({ allowWrite: true } as never);

    expect(applyPlaceholderAllowControls).toHaveBeenCalledWith(
      expect.objectContaining({ apply: true, placeholderSettingsRoots: ["/ph"] })
    );
    expect(
      logger.info.mock.calls.some((c) => String(c[0]).includes("Placeholder allow-controls"))
    ).toBe(true);
  });

  it("skips placeholder registration in --what-if mode", async () => {
    vi.mocked(io.loadRecipe).mockResolvedValue({
      kind: "component-template",
      handle: "hero",
      name: "Hero",
      placedIn: ["headless-main"],
    } as never);
    vi.mocked(shared.resolveTenant).mockReturnValue({
      root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
      envName: "test",
      environment: { placeholderSettingsRoots: ["/ph"] },
      client: { getItemsByPaths: vi.fn().mockResolvedValue(new Map()) },
    } as never);

    await runRecipePush({ whatIf: true } as never);

    expect(applyPlaceholderAllowControls).not.toHaveBeenCalled();
  });

  it("warns about unmatched placeholder keys and unresolved recipes", async () => {
    vi.mocked(io.loadRecipe).mockResolvedValue({
      kind: "component-template",
      handle: "hero",
      name: "Hero",
      placedIn: ["headless-main"],
    } as never);
    vi.mocked(shared.resolveTenant).mockReturnValue({
      root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
      envName: "test",
      environment: { placeholderSettingsRoots: ["/ph"] },
      client: { getItemsByPaths: vi.fn().mockResolvedValue(new Map()) },
    } as never);
    vi.mocked(applyPlaceholderAllowControls).mockResolvedValue({
      patched: 0,
      totalAdded: 0,
      unresolvedRecipeHandles: ["card"],
      unmatchedPlaceholderKeys: ["headless-main"],
    } as never);

    await runRecipePush({ allowWrite: true } as never);

    const warnings = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes("Unmatched placeholder keys"))).toBe(true);
    expect(warnings.some((w) => w.includes("couldn't be resolved"))).toBe(true);
  });
});

describe("runRecipePush — prefetch and events", () => {
  it("prefetches every CreateItem path through a single batched call", async () => {
    const getItemsByPaths = vi
      .fn()
      .mockResolvedValue(new Map([["/t/Hero", { itemId: "hero-id" }]]));
    vi.mocked(shared.resolveTenant).mockReturnValue({
      root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
      envName: "test",
      environment: { placeholderSettingsRoots: [] },
      client: { getItemsByPaths },
    } as never);

    await runRecipePush({ allowWrite: true } as never);

    expect(getItemsByPaths).toHaveBeenCalledTimes(1);
    expect(getItemsByPaths.mock.calls[0][0]).toContain("/t/Hero");
  });

  it("forwards execution events to the caller's emit hook", async () => {
    const emit = vi.fn();

    await runRecipePush({ allowWrite: true, emit } as never);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ recipe: "hero" });
  });

  it("surfaces the rollback log path when the rollback logger was used", async () => {
    vi.mocked(createRollbackLogger).mockReturnValue({
      runId: "rb-run",
      logPath: "/tmp/rb/rb-run.jsonl",
      wasUsed: true,
    } as never);

    await runRecipePush({ allowWrite: true } as never);

    expect(logger.warn.mock.calls.some((c) => String(c[0]).includes("Rollback audit log"))).toBe(
      true
    );
  });
});

describe("runRecipePush — IR-file and prefetch branches", () => {
  it("loads a pre-compiled .ir.json input directly instead of compiling it", async () => {
    vi.mocked(shared.resolveRecipeInputs).mockResolvedValue({
      files: ["dist/hero.ir.json"],
      source: "input",
    } as never);
    // No recipe files → compileRecipeSet gets an empty list.
    vi.mocked(compileRecipeSet).mockReturnValue([]);
    vi.mocked(io.loadIr).mockResolvedValue(makeIr("hero", [createItemOp("op-1", "/t/Hero")]));

    const results = await runRecipePush({ allowWrite: true } as never);

    expect(io.loadIr).toHaveBeenCalledWith("dist/hero.ir.json");
    expect(io.loadRecipe).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it("collects latePath and templateOf ref-path into the prefetch batch", async () => {
    const getItemsByPaths = vi.fn().mockResolvedValue(new Map());
    vi.mocked(shared.resolveTenant).mockReturnValue({
      root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
      envName: "test",
      environment: { placeholderSettingsRoots: [] },
      client: { getItemsByPaths },
    } as never);
    vi.mocked(compileRecipeSet).mockReturnValue([
      makeIr("hero", [
        {
          op: "CreateItem",
          id: "op-1",
          path: "/t/Hero",
          parent: { kind: "ref-path", value: "/t" },
          // templateOf as a ref-path → its parent path is also prefetched.
          templateOf: { kind: "ref-path", value: "/t/BaseTemplate" },
        },
        // SetField carrying a latePath → also collected.
        { op: "SetField", itemRefKey: "op-1", fieldId: "f", latePath: "/t/Late/Path" },
      ]),
    ]);

    await runRecipePush({ allowWrite: true } as never);

    const prefetched = getItemsByPaths.mock.calls[0][0] as string[];
    expect(prefetched).toContain("/t/BaseTemplate");
    expect(prefetched).toContain("/t/Late/Path");
  });

  it("seeds the Page Designs root refKey when pageDesignsRoot is set", async () => {
    vi.mocked(shared.resolveRecipeRoots).mockReturnValue({
      templatesRoot: "/t",
      renderingsRoot: "/r",
    } as never);
    vi.mocked(shared.resolveTenant).mockReturnValue({
      root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
      envName: "test",
      environment: { placeholderSettingsRoots: [], pageDesignsRoot: "/pd" },
      client: { getItemsByPaths: vi.fn().mockResolvedValue(new Map()) },
    } as never);

    await runRecipePush({ allowWrite: true } as never);

    // crossRecipeRefs is internal, but the executor receives it — assert
    // the run completed with the seeded config (no throw, one execute).
    expect(executeIr).toHaveBeenCalledTimes(1);
    const crossRefs = vi.mocked(executeIr).mock.calls[0][2]?.crossRecipeRefs as Map<string, string>;
    expect([...crossRefs.values()]).toContain("/pd");
  });
});

describe("runRecipePush — aborted result rendering", () => {
  it("warns about the rollback summary when a push aborts mid-apply", async () => {
    vi.mocked(executeIr).mockResolvedValue(
      makeResult("hero", {
        aborted: true,
        summary: { create: 0, update: 1, skip: 0, error: 1 },
        rollback: {
          rolledBack: 1,
          errors: [{ label: "Set Y", error: "rollback boom" }],
        },
      }) as never
    );

    await runRecipePush({ allowWrite: true } as never);

    const warnings = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes("Push aborted at op"))).toBe(true);
    expect(warnings.some((w) => w.includes("rollback failed at Set Y"))).toBe(true);
  });

  it("maps operation-keyed and error-keyed events into the JSON envelope", async () => {
    jsonMode = true;
    vi.mocked(executeIr).mockImplementation(async (ir, _client, opts) => {
      const emit = (opts as { emit?: (e: unknown) => void }).emit;
      // Event carrying `operation` + `index` (e.g. op-start).
      emit?.({ kind: "op-start", index: 3, operation: { label: "Create A" } });
      // Event carrying `action`.
      emit?.({
        kind: "op-applied",
        action: {
          index: 4,
          status: "update",
          operation: { label: "Set B" },
          reason: "field drift",
          diff: { before: "x", after: "y" },
          mutation: true,
        },
      });
      // Event carrying `error`.
      emit?.({ kind: "ir-error", error: "executor blew up" });
      return makeResult((ir as { recipeHandle: string }).recipeHandle) as never;
    });

    await runRecipePush({ allowWrite: true } as never);

    const envelope = logger.json.mock.calls[0][0] as { events: Array<Record<string, unknown>> };
    const events = envelope.events;
    expect(events).toHaveLength(3);
    // operation-keyed event → label lifted, index from `index`.
    expect(events[0]).toMatchObject({ kind: "op-start", index: 3, label: "Create A" });
    // action-keyed event → label/status/reason/diff/mutation lifted.
    expect(events[1]).toMatchObject({
      kind: "op-applied",
      index: 4,
      label: "Set B",
      status: "update",
      reason: "field drift",
      mutation: true,
    });
    // error-keyed event → error string lifted.
    expect(events[2]).toMatchObject({ kind: "ir-error", error: "executor blew up" });
  });

  it("renders an error-summary action tag for an errored op", async () => {
    vi.mocked(executeIr).mockResolvedValue(
      makeResult("hero", {
        plan: {
          schemaVersion: "1",
          recipeHandle: "hero",
          actions: [
            {
              index: 0,
              status: "error",
              operation: { label: "Create X" },
              reason: "permission denied",
              mutation: false,
            },
          ],
          summary: { create: 0, update: 0, skip: 0, error: 1 },
        },
        summary: { create: 0, update: 0, skip: 0, error: 1 },
        aborted: false,
      }) as never
    );

    await runRecipePush({ allowWrite: true } as never);

    const lines = logger.info.mock.calls.map((c) => String(c[0]));
    // formatActionTag's "error" arm → "[!]"; the reason is appended.
    expect(lines.some((l) => l.includes("[!]") && l.includes("permission denied"))).toBe(true);
  });
});
