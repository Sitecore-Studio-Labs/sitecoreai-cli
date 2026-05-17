/**
 * `src/agents/api/widgets.ts` — widget CRUD + AI-assisted spec generation.
 *
 * The transport (`agentsRequest` / `agentsStream`) is exercised directly
 * in `request.test.ts`; here it is mocked so each widget operation's
 * request shape (path, method, body) and response handling can be
 * asserted in isolation.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";
import type { Widget, WidgetSpec } from "../../../../src/agents/api/schema";

vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: vi.fn(),
  agentsStream: vi.fn(),
}));

let widgets: typeof import("../../../../src/agents/api/widgets");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

const spec: WidgetSpec = { root: "r", elements: {} } as never;

const widgetFixture = (over: Partial<Widget> = {}): Widget =>
  ({ id: "w-1", name: "Sales", spec, ...over }) as Widget;

beforeAll(async () => {
  widgets = await import("../../../../src/agents/api/widgets");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listWidgets", () => {
  it("returns the array when the API responds with a widget list", async () => {
    const list = [widgetFixture({ id: "w-1" }), widgetFixture({ id: "w-2", name: "Ops" })];
    vi.mocked(request.agentsRequest).mockResolvedValue(list as never);

    const result = await widgets.listWidgets(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/widgets");
    expect(result).toEqual(list);
  });

  it("coerces a non-array response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ unexpected: true } as never);
    expect(await widgets.listWidgets(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await widgets.listWidgets(session)).toEqual([]);
  });
});

describe("getWidget", () => {
  it("finds a widget by id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      widgetFixture({ id: "w-1", name: "Sales" }),
      widgetFixture({ id: "w-2", name: "Ops" }),
    ] as never);

    const found = await widgets.getWidget(session, "w-2");
    expect(found?.id).toBe("w-2");
  });

  it("finds a widget by name when no id matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      widgetFixture({ id: "w-1", name: "Sales" }),
    ] as never);

    const found = await widgets.getWidget(session, "Sales");
    expect(found?.id).toBe("w-1");
  });

  it("returns undefined when neither id nor name matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      widgetFixture({ id: "w-1", name: "Sales" }),
    ] as never);

    expect(await widgets.getWidget(session, "missing")).toBeUndefined();
  });

  it("returns undefined when the widget list is empty", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([] as never);
    expect(await widgets.getWidget(session, "w-1")).toBeUndefined();
  });
});

describe("createWidget", () => {
  it("POSTs name, spec, and an explicit description", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(widgetFixture() as never);

    const result = await widgets.createWidget(session, {
      name: "Sales",
      description: "Q3 numbers",
      spec,
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/widgets", {
      method: "POST",
      body: { name: "Sales", description: "Q3 numbers", spec },
    });
    expect(result.id).toBe("w-1");
  });

  it("normalizes a missing description to null in the request body", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(widgetFixture() as never);

    await widgets.createWidget(session, { name: "Sales", spec });

    const body = vi.mocked(request.agentsRequest).mock.calls[0][2]?.body as {
      description: unknown;
    };
    expect(body.description).toBeNull();
  });
});

describe("updateWidget", () => {
  it("PUTs to the id-scoped path with a full-replacement body", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await widgets.updateWidget(session, {
      id: "w-1",
      name: "Sales",
      description: "updated",
      spec,
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/widgets/w-1", {
      method: "PUT",
      body: { name: "Sales", description: "updated", spec },
    });
  });

  it("url-encodes a widget id containing reserved characters", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await widgets.updateWidget(session, { id: "a/b c", name: "n", spec });

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/widgets/a%2Fb%20c");
  });

  it("normalizes a missing description to null", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await widgets.updateWidget(session, { id: "w-1", name: "n", spec });

    const body = vi.mocked(request.agentsRequest).mock.calls[0][2]?.body as {
      description: unknown;
    };
    expect(body.description).toBeNull();
  });
});

describe("deleteWidget", () => {
  it("DELETEs the id-scoped path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await widgets.deleteWidget(session, "w-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/widgets/w-1", {
      method: "DELETE",
    });
  });

  it("url-encodes the widget id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await widgets.deleteWidget(session, "w/1");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/widgets/w%2F1");
  });
});

describe("generateWidgetSpec", () => {
  async function* chunks(...parts: string[]): AsyncIterable<string> {
    for (const part of parts) yield part;
  }
  const collect = async (
    it: AsyncIterable<{ op: string; path: string; value?: unknown }>
  ): Promise<unknown[]> => {
    const out: unknown[] = [];
    for await (const patch of it) out.push(patch);
    return out;
  };

  it("POSTs the prompt with the supplied current spec as context", async () => {
    vi.mocked(request.agentsStream).mockReturnValue(chunks(""));

    await collect(widgets.generateWidgetSpec(session, "make a chart", spec));

    expect(request.agentsStream).toHaveBeenCalledWith(session, "/api/generate-spec", {
      method: "POST",
      body: {
        prompt: "make a chart",
        context: { previousSpec: null },
        currentSpec: spec,
      },
    });
  });

  it("defaults currentSpec to an empty spec when none is supplied", async () => {
    vi.mocked(request.agentsStream).mockReturnValue(chunks(""));

    await collect(widgets.generateWidgetSpec(session, "make a chart"));

    const body = vi.mocked(request.agentsStream).mock.calls[0][2].body as {
      currentSpec: unknown;
    };
    expect(body.currentSpec).toEqual({ root: "", elements: {} });
  });

  it("yields one patch per newline-delimited JSON line", async () => {
    vi.mocked(request.agentsStream).mockReturnValue(
      chunks('{"op":"add","path":"/a"}\n', '{"op":"replace","path":"/b","value":1}\n')
    );

    const patches = await collect(widgets.generateWidgetSpec(session, "p"));
    expect(patches).toEqual([
      { op: "add", path: "/a" },
      { op: "replace", path: "/b", value: 1 },
    ]);
  });

  it("reassembles a JSON patch split across stream chunks", async () => {
    vi.mocked(request.agentsStream).mockReturnValue(chunks('{"op":"ad', 'd","path":"/a"}\n'));

    expect(await collect(widgets.generateWidgetSpec(session, "p"))).toEqual([
      { op: "add", path: "/a" },
    ]);
  });

  it("emits a trailing patch that arrives without a terminating newline", async () => {
    vi.mocked(request.agentsStream).mockReturnValue(chunks('{"op":"add","path":"/last"}'));

    expect(await collect(widgets.generateWidgetSpec(session, "p"))).toEqual([
      { op: "add", path: "/last" },
    ]);
  });

  it("skips blank and unparseable lines instead of throwing", async () => {
    vi.mocked(request.agentsStream).mockReturnValue(
      chunks("\n", "not json\n", '{"op":"add","path":"/ok"}\n', "   ")
    );

    expect(await collect(widgets.generateWidgetSpec(session, "p"))).toEqual([
      { op: "add", path: "/ok" },
    ]);
  });
});
