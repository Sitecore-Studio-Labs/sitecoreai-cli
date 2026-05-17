/**
 * `src/agents/api/skills.ts` — skill CRUD against the Agentic Studio BFF.
 *
 * The transport (`agentsRequest`) is exercised directly in `request.test.ts`;
 * here it is mocked so each skill operation's request shape (path, method,
 * body, id URL-encoding) and the optional-field `?? []` / `?? "team"`
 * normalization can be asserted in isolation.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";
import type { Skill } from "../../../../src/agents/api/schema";

vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: vi.fn(),
}));

let skills: typeof import("../../../../src/agents/api/skills");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

const skillFixture = (over: Partial<Skill> = {}): Skill =>
  ({
    id: "s-1",
    slug: "tone",
    name: "Tone",
    description: "House style",
    ...over,
  }) as Skill;

beforeAll(async () => {
  skills = await import("../../../../src/agents/api/skills");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSkills", () => {
  it("returns the array when the API responds with a skill list", async () => {
    const list = [skillFixture({ id: "s-1" }), skillFixture({ id: "s-2", slug: "voice" })];
    vi.mocked(request.agentsRequest).mockResolvedValue(list as never);

    const result = await skills.listSkills(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/skills");
    expect(result).toEqual(list);
  });

  it("coerces a non-array response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ unexpected: true } as never);
    expect(await skills.listSkills(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await skills.listSkills(session)).toEqual([]);
  });
});

describe("getSkill", () => {
  it("finds a skill by id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      skillFixture({ id: "s-1", slug: "tone" }),
      skillFixture({ id: "s-2", slug: "voice" }),
    ] as never);

    const found = await skills.getSkill(session, "s-2");
    expect(found?.id).toBe("s-2");
  });

  it("finds a skill by slug when no id matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      skillFixture({ id: "s-1", slug: "tone" }),
    ] as never);

    const found = await skills.getSkill(session, "tone");
    expect(found?.id).toBe("s-1");
  });

  it("returns undefined when neither id nor slug matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      skillFixture({ id: "s-1", slug: "tone" }),
    ] as never);

    expect(await skills.getSkill(session, "missing")).toBeUndefined();
  });

  it("returns undefined when the skill list is empty", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([] as never);
    expect(await skills.getSkill(session, "s-1")).toBeUndefined();
  });
});

describe("createSkill", () => {
  it("POSTs every field with explicit tags and visibility", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(skillFixture() as never);

    const result = await skills.createSkill(session, {
      name: "Tone",
      description: "House style",
      content: "# Tone\nBe concise.",
      tags: ["style"],
      visibility: "private",
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/skills", {
      method: "POST",
      body: {
        name: "Tone",
        description: "House style",
        content: "# Tone\nBe concise.",
        tags: ["style"],
        visibility: "private",
      },
    });
    expect(result.id).toBe("s-1");
  });

  it("normalizes missing tags to [] and missing visibility to 'team'", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(skillFixture() as never);

    await skills.createSkill(session, {
      name: "Tone",
      description: "House style",
      content: "body",
    });

    const body = vi.mocked(request.agentsRequest).mock.calls[0][2]?.body as {
      tags: unknown;
      visibility: unknown;
    };
    expect(body.tags).toEqual([]);
    expect(body.visibility).toBe("team");
  });
});

describe("updateSkill", () => {
  it("PUTs a full-replacement body to the id-scoped path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await skills.updateSkill(session, {
      id: "s-1",
      name: "Tone",
      description: "Updated",
      content: "new body",
      tags: ["style"],
      visibility: "private",
    });

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/skills/s-1", {
      method: "PUT",
      body: {
        name: "Tone",
        description: "Updated",
        content: "new body",
        tags: ["style"],
        visibility: "private",
      },
    });
  });

  it("normalizes missing tags to [] and missing visibility to 'team'", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await skills.updateSkill(session, {
      id: "s-1",
      name: "Tone",
      description: "Updated",
      content: "new body",
    });

    const body = vi.mocked(request.agentsRequest).mock.calls[0][2]?.body as {
      tags: unknown;
      visibility: unknown;
    };
    expect(body.tags).toEqual([]);
    expect(body.visibility).toBe("team");
  });

  it("url-encodes a skill id containing reserved characters", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await skills.updateSkill(session, {
      id: "s/1 a",
      name: "n",
      description: "d",
      content: "c",
    });

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/skills/s%2F1%20a");
  });
});

describe("deleteSkill", () => {
  it("DELETEs the id-scoped path", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await skills.deleteSkill(session, "s-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/skills/s-1", {
      method: "DELETE",
    });
  });

  it("url-encodes the skill id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await skills.deleteSkill(session, "s/1");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/skills/s%2F1");
  });
});
