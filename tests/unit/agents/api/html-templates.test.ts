/**
 * `src/agents/api/html-templates.ts` — HTML template CRUD.
 *
 * `listHtmlTemplates` / `getHtmlTemplate` / `deleteHtmlTemplate` ride
 * `agentsRequest`; `createHtmlTemplate` / `updateHtmlTemplate` replay
 * `/html-templates/*` Next.js server actions via `agentsServerAction`. Both
 * transports are mocked here so the request shape (path, method, body,
 * server-action args / hash / router tree) and response handling — including
 * the `RSC_UNDEFINED` optional substitution — can be asserted in isolation.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";
import type { HtmlTemplate } from "../../../../src/agents/api/schema";

vi.mock("../../../../src/agents/api/request", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/agents/api/request")>(
    "../../../../src/agents/api/request"
  );
  return {
    agentsRequest: vi.fn(),
    agentsServerAction: vi.fn(),
    RSC_UNDEFINED: actual.RSC_UNDEFINED,
  };
});

let templates: typeof import("../../../../src/agents/api/html-templates");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

const templateFixture = (over: Partial<HtmlTemplate> = {}): HtmlTemplate =>
  ({ id: "t-1", templateId: "t-1", name: "Hero", code: "<h1></h1>", ...over }) as HtmlTemplate;

beforeAll(async () => {
  templates = await import("../../../../src/agents/api/html-templates");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SITECOREAI_HTML_TEMPLATE_ACTION;
  delete process.env.SITECOREAI_HTML_TEMPLATE_UPDATE_ACTION;
});

describe("listHtmlTemplates", () => {
  it("returns the array when the API responds with a template list", async () => {
    const list = [templateFixture({ id: "t-1" }), templateFixture({ id: "t-2", name: "CTA" })];
    vi.mocked(request.agentsRequest).mockResolvedValue(list as never);

    const result = await templates.listHtmlTemplates(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/html-templates");
    expect(result).toEqual(list);
  });

  it("coerces a non-array response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ unexpected: true } as never);
    expect(await templates.listHtmlTemplates(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await templates.listHtmlTemplates(session)).toEqual([]);
  });
});

describe("getHtmlTemplate", () => {
  it("finds a template by id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      templateFixture({ id: "t-1", templateId: "x", name: "Hero" }),
      templateFixture({ id: "t-2", templateId: "y", name: "CTA" }),
    ] as never);

    const found = await templates.getHtmlTemplate(session, "t-2");
    expect(found?.id).toBe("t-2");
  });

  it("finds a template by templateId when no id matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      templateFixture({ id: "t-1", templateId: "hero-tpl", name: "Hero" }),
    ] as never);

    const found = await templates.getHtmlTemplate(session, "hero-tpl");
    expect(found?.id).toBe("t-1");
  });

  it("finds a template by name when neither id nor templateId matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      templateFixture({ id: "t-1", templateId: "x", name: "Hero" }),
    ] as never);

    const found = await templates.getHtmlTemplate(session, "Hero");
    expect(found?.id).toBe("t-1");
  });

  it("returns undefined when nothing matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      templateFixture({ id: "t-1", templateId: "x", name: "Hero" }),
    ] as never);

    expect(await templates.getHtmlTemplate(session, "missing")).toBeUndefined();
  });

  it("returns undefined when the template list is empty", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([] as never);
    expect(await templates.getHtmlTemplate(session, "t-1")).toBeUndefined();
  });
});

describe("createHtmlTemplate", () => {
  it("replays the /html-templates/create server action with the [null, payload] tuple", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.createHtmlTemplate(session, {
      name: "Hero",
      code: "<h1>Hi</h1>",
      description: "A hero",
      tags: ["marketing"],
    });

    expect(request.agentsServerAction).toHaveBeenCalledTimes(1);
    const [, path, payload] = vi.mocked(request.agentsServerAction).mock.calls[0];
    expect(path).toBe("/html-templates/create");
    expect(payload.routerStateTree).toContain('"html-templates"');
    expect(payload.args).toEqual([
      null,
      {
        templateId: "Hero",
        name: "Hero",
        code: "<h1>Hi</h1>",
        description: "A hero",
        tags: ["marketing"],
      },
    ]);
  });

  it("substitutes RSC_UNDEFINED for absent description and tags", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.createHtmlTemplate(session, { name: "Hero", code: "<h1></h1>" });

    const body = (
      vi.mocked(request.agentsServerAction).mock.calls[0][2].args as [
        unknown,
        Record<string, unknown>,
      ]
    )[1];
    expect(body.description).toBe(request.RSC_UNDEFINED);
    expect(body.tags).toBe(request.RSC_UNDEFINED);
  });

  it("uses the session's discovered action hash when present", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.createHtmlTemplate(
      { ...session, actionHashes: { "/html-templates/create": "session-hash" } },
      { name: "Hero", code: "<h1></h1>" }
    );

    expect(vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash).toBe("session-hash");
  });

  it("falls back to SITECOREAI_HTML_TEMPLATE_ACTION when no session hash exists", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);
    process.env.SITECOREAI_HTML_TEMPLATE_ACTION = "env-hash";

    await templates.createHtmlTemplate(session, { name: "Hero", code: "<h1></h1>" });

    expect(vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash).toBe("env-hash");
  });

  it("falls back to the bundled constant hash when neither session nor env is set", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.createHtmlTemplate(session, { name: "Hero", code: "<h1></h1>" });

    const hash = vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash;
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe("updateHtmlTemplate", () => {
  it("replays the /html-templates/{id} server action with the [id, payload] tuple", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.updateHtmlTemplate(session, {
      id: "t-1",
      name: "Hero",
      code: "<h1>Updated</h1>",
      description: "Updated hero",
      tags: ["marketing"],
    });

    const [, path, payload] = vi.mocked(request.agentsServerAction).mock.calls[0];
    expect(path).toBe("/html-templates/t-1");
    expect(payload.routerStateTree).toContain('"t-1"');
    expect(payload.args).toEqual([
      "t-1",
      {
        templateId: "Hero",
        name: "Hero",
        description: "Updated hero",
        code: "<h1>Updated</h1>",
        tags: ["marketing"],
      },
    ]);
  });

  it("substitutes RSC_UNDEFINED for absent description and tags", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.updateHtmlTemplate(session, {
      id: "t-1",
      name: "Hero",
      code: "<h1></h1>",
    });

    const body = (
      vi.mocked(request.agentsServerAction).mock.calls[0][2].args as [
        unknown,
        Record<string, unknown>,
      ]
    )[1];
    expect(body.description).toBe(request.RSC_UNDEFINED);
    expect(body.tags).toBe(request.RSC_UNDEFINED);
  });

  it("url-encodes the template id in the action path", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.updateHtmlTemplate(session, {
      id: "t/1 a",
      name: "Hero",
      code: "<h1></h1>",
    });

    expect(vi.mocked(request.agentsServerAction).mock.calls[0][1]).toBe(
      "/html-templates/t%2F1%20a"
    );
  });

  it("embeds the raw (un-encoded) id in the router state tree", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.updateHtmlTemplate(session, {
      id: "t-1",
      name: "Hero",
      code: "<h1></h1>",
    });

    const tree = vi.mocked(request.agentsServerAction).mock.calls[0][2].routerStateTree;
    expect(tree).toContain('"id","t-1"');
  });

  it("falls back to SITECOREAI_HTML_TEMPLATE_UPDATE_ACTION when set", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);
    process.env.SITECOREAI_HTML_TEMPLATE_UPDATE_ACTION = "env-update-hash";

    await templates.updateHtmlTemplate(session, {
      id: "t-1",
      name: "Hero",
      code: "<h1></h1>",
    });

    expect(vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash).toBe(
      "env-update-hash"
    );
  });

  it("falls back to the bundled update constant hash when env is unset", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await templates.updateHtmlTemplate(session, {
      id: "t-1",
      name: "Hero",
      code: "<h1></h1>",
    });

    const hash = vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash;
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe("deleteHtmlTemplate", () => {
  it("DELETEs the id-scoped path via agentsRequest", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await templates.deleteHtmlTemplate(session, "t-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/html-templates/t-1", {
      method: "DELETE",
    });
  });

  it("url-encodes the template id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await templates.deleteHtmlTemplate(session, "t/1 a");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/html-templates/t%2F1%20a");
  });
});
