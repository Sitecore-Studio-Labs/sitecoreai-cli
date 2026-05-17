import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → session bridge so the kind never reads real config or
// touches the keychain. `widget.kind.ts` imports `resolveAgentsSession`
// from `./client` — i.e. src/agents/recipe/client.ts.
const resolveAgentsSession = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/agents/recipe/client", () => ({ resolveAgentsSession }));

// Mock the widgets API surface the kind composes.
const widgetsApi = vi.hoisted(() => ({
  createWidget: vi.fn(),
  listWidgets: vi.fn(),
}));
vi.mock("../../../../src/agents/api/widgets", () => widgetsApi);

import { widgetKind } from "../../../../src/agents/recipe/widget.kind";
import { WidgetRecipeSchema } from "../../../../src/agents/recipe/widget.schema";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "widget", id: "Scorecard" } as const;

const recipe = (input: unknown) => WidgetRecipeSchema.parse(input);

const makeWidget = (overrides: Record<string, unknown> = {}) => ({
  id: "widget-id-1",
  name: "Scorecard",
  description: "A scorecard widget",
  spec: { root: "root", elements: { root: { type: "panel" } } },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveAgentsSession.mockResolvedValue(SESSION);
});

describe("widgetKind — recipe-kind contract", () => {
  it("exposes the name, schema, and the three operations", () => {
    expect(widgetKind.name).toBe("widget");
    expect(widgetKind.schema).toBe(WidgetRecipeSchema);
    expect(typeof widgetKind.readCurrent).toBe("function");
    expect(typeof widgetKind.plan).toBe("function");
    expect(typeof widgetKind.apply).toBe("function");
  });
});

describe("widgetKind.readCurrent", () => {
  it("returns null when no widget matches the ref name", async () => {
    widgetsApi.listWidgets.mockResolvedValue([makeWidget({ name: "Other" })]);

    expect(await widgetKind.readCurrent(ref, ctx)).toBeNull();
  });

  it("projects a live widget into the recipe shape", async () => {
    widgetsApi.listWidgets.mockResolvedValue([makeWidget()]);

    const result = await widgetKind.readCurrent(ref, ctx);

    expect(result).toEqual({
      name: "Scorecard",
      description: "A scorecard widget",
      spec: { root: "root", elements: { root: { type: "panel" } } },
    });
  });

  it("matches the widget by exact name only — not by id", async () => {
    widgetsApi.listWidgets.mockResolvedValue([makeWidget({ name: "Scorecard" })]);

    const result = await widgetKind.readCurrent({ kind: "widget", id: "widget-id-1" }, ctx);

    expect(result).toBeNull();
  });

  it("leaves description undefined when the live widget has none", async () => {
    widgetsApi.listWidgets.mockResolvedValue([makeWidget({ description: undefined })]);

    const result = await widgetKind.readCurrent(ref, ctx);

    expect(result?.description).toBeUndefined();
  });

  it("coerces a null description to undefined", async () => {
    widgetsApi.listWidgets.mockResolvedValue([makeWidget({ description: null })]);

    const result = await widgetKind.readCurrent(ref, ctx);

    expect(result?.description).toBeUndefined();
  });

  it("defaults the spec to an empty element tree when the live widget omits it", async () => {
    widgetsApi.listWidgets.mockResolvedValue([makeWidget({ spec: undefined })]);

    const result = await widgetKind.readCurrent(ref, ctx);

    expect(result?.spec).toEqual({ root: "", elements: {} });
  });
});

describe("widgetKind.plan", () => {
  it("plans a create when the widget does not exist remotely", async () => {
    widgetsApi.listWidgets.mockResolvedValue([]);

    const plan = await widgetKind.plan(
      recipe({ name: "Scorecard", spec: { root: "r", elements: {} } }),
      ref,
      ctx
    );

    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "widget.Scorecard" });
    expect(plan.changes[0].meta?.recipe).toMatchObject({ name: "Scorecard" });
  });

  it("plans a noop when the widget already exists — create-only kind", async () => {
    widgetsApi.listWidgets.mockResolvedValue([makeWidget()]);

    const plan = await widgetKind.plan(
      recipe({ name: "Scorecard", spec: { root: "changed", elements: {} } }),
      ref,
      ctx
    );

    expect(plan.changes[0].kind).toBe("noop");
  });
});

describe("widgetKind.apply — noop / empty plan", () => {
  it("returns nothing applied and nothing skipped for an empty plan", async () => {
    const result = await widgetKind.apply({ changes: [] }, ref, ctx);

    expect(result).toEqual({ applied: [], skipped: [] });
    expect(widgetsApi.createWidget).not.toHaveBeenCalled();
  });

  it("skips a noop change without touching the API", async () => {
    const result = await widgetKind.apply(
      { changes: [{ kind: "noop", path: "widget.Scorecard", summary: "exists" }] },
      ref,
      ctx
    );

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(widgetsApi.createWidget).not.toHaveBeenCalled();
  });
});

describe("widgetKind.apply — create", () => {
  it("creates the widget from the change's meta.recipe, coercing description to null", async () => {
    widgetsApi.createWidget.mockResolvedValue(makeWidget());

    const result = await widgetKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "widget.Scorecard",
            summary: "create widget",
            meta: { recipe: recipe({ name: "Scorecard", spec: { root: "r", elements: {} } }) },
          },
        ],
      },
      ref,
      ctx
    );

    expect(widgetsApi.createWidget).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({
        name: "Scorecard",
        description: null,
        spec: { root: "r", elements: {} },
      })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("passes a present description straight through to createWidget", async () => {
    widgetsApi.createWidget.mockResolvedValue(makeWidget());

    await widgetKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "widget.Scorecard",
            summary: "create widget",
            meta: {
              recipe: recipe({
                name: "Scorecard",
                description: "with desc",
                spec: { root: "r", elements: {} },
              }),
            },
          },
        ],
      },
      ref,
      ctx
    );

    expect(widgetsApi.createWidget).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ description: "with desc" })
    );
  });

  it("falls back to parsing change.after when meta.recipe is absent", async () => {
    widgetsApi.createWidget.mockResolvedValue(makeWidget());

    await widgetKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "widget.Scorecard",
            summary: "create widget",
            after: { name: "Scorecard", spec: { root: "from-after", elements: {} } },
          },
        ],
      },
      ref,
      ctx
    );

    expect(widgetsApi.createWidget).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ spec: { root: "from-after", elements: {} } })
    );
  });

  it("throws when change.after is invalid (missing spec) and no meta.recipe is present", async () => {
    await expect(
      widgetKind.apply(
        {
          changes: [
            {
              kind: "create",
              path: "widget.Scorecard",
              summary: "create widget",
              after: { name: "Scorecard" },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow();
    expect(widgetsApi.createWidget).not.toHaveBeenCalled();
  });
});
