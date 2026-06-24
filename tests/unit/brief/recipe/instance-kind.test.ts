import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env -> client bridge so the kind never reads real config or
// mints a real token.
vi.mock("../../../../src/brief/recipe/client", () => ({
  resolveBriefClient: async () => ({ accessToken: "tok" }),
}));

// Mock the Brief API surface the kind composes.
const briefApi = vi.hoisted(() => ({
  listBriefTypes: vi.fn(),
  listBriefs: vi.fn(),
  getBrief: vi.fn(),
  createBrief: vi.fn(),
  updateBrief: vi.fn(),
  linkBriefToProject: vi.fn(),
  listBriefTasks: vi.fn(async () => ({ totalCount: 0, next: null, data: [] })),
  createBriefTask: vi.fn(),
  deleteBriefTask: vi.fn(),
  createBriefComment: vi.fn(),
}));
vi.mock("../../../../src/brief", () => briefApi);

// Mock the campaign surface used by campaignHandle → projectId resolution
// and brief→campaign link verification (the reverse-view re-read).
const campaignApi = vi.hoisted(() => ({
  listProjects: vi.fn(async () => ({ next: null, data: [] as Array<Record<string, unknown>> })),
  getProject: vi.fn(async () => ({ briefs: [] as Array<{ id: string }> })),
}));
vi.mock("../../../../src/campaigns", () => campaignApi);
vi.mock("../../../../src/campaigns/recipe/client", () => ({
  resolveCampaignClient: async () => ({ accessToken: "tok" }),
}));

import {
  briefInstanceKind,
  htmlToProseMirrorDoc,
} from "../../../../src/brief/recipe/instance-kind";

/** Flatten a ProseMirror doc to the concatenated text of its leaf nodes. */
const docText = (doc: Record<string, unknown>): string => {
  const paras = (doc.content ?? []) as Array<{ content?: Array<{ text?: string }> }>;
  return paras.map((p) => (p.content ?? []).map((n) => n.text ?? "").join("")).join("\n");
};

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "brief", id: "Q3 Launch" } as const;

const liveType = {
  id: "type-1",
  name: "CreativeBrief",
  label: { "en-us": "Creative Brief" },
  description: "",
  icon: "mdi-pencil",
  iconColor: "#000",
  fields: [],
  createdOn: "2026-01-01T00:00:00Z",
  createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
  updatedOn: "2026-01-01T00:00:00Z",
  updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
};

const liveBrief = {
  id: "brief-1",
  icon: null,
  name: "Q3 Launch",
  status: "Draft" as const,
  locale: "en-us",
  fields: { summary: { type: "RichText", value: { kind: "doc", children: [] } } },
  briefType: {
    type: "Link" as const,
    relatedType: "BriefType",
    id: "type-1",
    uri: "/api/brief/v1/brief-types/type-1",
  },
  isTemplate: false,
  comments: [],
  tasks: [],
  references: [],
  contributors: [],
  externalMappings: [],
  createdOn: "2026-01-01T00:00:00Z",
  createdBy: { type: "ExternalLink" as const, relatedSystem: "co", relatedType: null, id: "x" },
  updatedOn: "2026-01-01T00:00:00Z",
  updatedBy: { type: "ExternalLink" as const, relatedSystem: "co", relatedType: null, id: "x" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("briefInstanceKind", () => {
  it("exposes the recipe-kind contract", () => {
    expect(briefInstanceKind.name).toBe("brief");
    expect(briefInstanceKind.schema).toBeDefined();
    expect(typeof briefInstanceKind.readCurrent).toBe("function");
    expect(typeof briefInstanceKind.plan).toBe("function");
    expect(typeof briefInstanceKind.apply).toBe("function");
    expect(typeof briefInstanceKind.list).toBe("function");
  });
});

describe("list", () => {
  it("walks the paged list endpoint and emits one KindRef per brief", async () => {
    briefApi.listBriefs
      .mockResolvedValueOnce({
        totalCount: 3,
        next: "cursor-1",
        data: [
          { ...liveBrief, name: "A" },
          { ...liveBrief, name: "B" },
        ],
      })
      .mockResolvedValueOnce({
        totalCount: 3,
        next: null,
        data: [{ ...liveBrief, name: "C" }],
      });

    const refs = await briefInstanceKind.list?.(ctx);

    expect(refs).toEqual([
      { kind: "brief", id: "A" },
      { kind: "brief", id: "B" },
      { kind: "brief", id: "C" },
    ]);
    // The first call has no cursor; the second carries the prior page's next.
    expect(briefApi.listBriefs.mock.calls[0][1]).toBeUndefined();
    expect(briefApi.listBriefs.mock.calls[1][1]).toEqual({ next: "cursor-1" });
  });
});

describe("readCurrent", () => {
  it("returns null when no brief matches the name", async () => {
    briefApi.listBriefs.mockResolvedValue({ totalCount: 0, next: null, data: [] });
    expect(await briefInstanceKind.readCurrent({ kind: "brief", id: "Nope" }, ctx)).toBeNull();
  });

  it("reads by UUID (getBrief) when ref.tenantId is set — never walks the broken brief list", async () => {
    // The Brief list endpoint caps at 20 rows with a non-advancing cursor,
    // so a name walk can't see briefs past page 1. When the ref carries the
    // UUID (orchestrator forward / `--sitecore-id`), readCurrent must read
    // the brief directly by id and NOT call listBriefs at all.
    briefApi.getBrief.mockResolvedValue({ ...liveBrief, id: "brief-1" });
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });

    const recipe = await briefInstanceKind.readCurrent(
      { kind: "brief", id: "ANY_NAME_EVEN_BOGUS", tenantId: "brief-1" },
      ctx
    );

    expect(recipe?.name).toBe("Q3 Launch");
    expect(briefApi.getBrief).toHaveBeenCalledWith(expect.anything(), "brief-1");
    expect(briefApi.listBriefs).not.toHaveBeenCalled();
  });

  it("builds a recipe from the matched brief, dropping server ids and resolving the type codename", async () => {
    briefApi.listBriefs.mockResolvedValue({ totalCount: 1, next: null, data: [liveBrief] });
    briefApi.getBrief.mockResolvedValue(liveBrief);
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });

    const recipe = await briefInstanceKind.readCurrent(ref, ctx);

    expect(recipe).toEqual({
      name: "Q3 Launch",
      briefTypeName: "CreativeBrief",
      locale: "en-us",
      status: "Draft",
      isTemplate: false,
      fields: { summary: { type: "RichText", value: { kind: "doc", children: [] } } },
      todos: [],
    });
    expect(recipe).not.toHaveProperty("id");
    expect(recipe).not.toHaveProperty("createdOn");
  });

  it("projects tenant tasks into the recipe's todos array", async () => {
    briefApi.listBriefs.mockResolvedValue({ totalCount: 1, next: null, data: [liveBrief] });
    briefApi.getBrief.mockResolvedValue(liveBrief);
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });
    briefApi.listBriefTasks.mockResolvedValueOnce({
      totalCount: 2,
      next: null,
      data: [
        {
          id: "task-1",
          title: "Review with CSM",
          assignees: [
            { type: "ExternalLink", relatedSystem: "auth0", relatedType: null, id: "auth0|alice" },
          ],
        },
        { id: "task-2", title: "Sign off", assignees: [] },
      ],
    });

    const recipe = await briefInstanceKind.readCurrent(ref, ctx);

    expect(recipe?.todos).toEqual([
      { title: "Review with CSM", assigneeIds: ["auth0|alice"] },
      { title: "Sign off" },
    ]);
    expect(briefApi.listBriefTasks).toHaveBeenCalledWith(
      { accessToken: "tok" },
      { briefId: "brief-1", metadataToLoad: ["assignees"] }
    );
  });

  it("falls back to the brief-type UUID when the type has been deleted (orphan)", async () => {
    briefApi.listBriefs.mockResolvedValue({ totalCount: 1, next: null, data: [liveBrief] });
    briefApi.getBrief.mockResolvedValue(liveBrief);
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 0, next: null, data: [] });

    const recipe = await briefInstanceKind.readCurrent(ref, ctx);

    expect(recipe?.briefTypeName).toBe("type-1");
  });
});

describe("apply — create", () => {
  it("resolves briefTypeName -> id and POSTs createBrief", async () => {
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });
    briefApi.createBrief.mockResolvedValue({ ...liveBrief, id: "brief-9", status: "Draft" });

    const recipe = briefInstanceKind.schema.parse({
      name: "Q3 Launch",
      briefTypeName: "CreativeBrief",
      locale: "en-us",
      fields: { summary: { type: "RichText", value: {} } },
    });

    const result = await briefInstanceKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "brief",
            summary: 'Create brief "Q3 Launch"',
            after: "Q3 Launch",
            meta: { stage: "instance", recipe },
          },
        ],
      },
      ref,
      ctx
    );

    expect(briefApi.createBrief).toHaveBeenCalledOnce();
    expect(briefApi.createBrief.mock.calls[0][1]).toMatchObject({
      name: "Q3 Launch",
      briefTypeId: "type-1",
      locale: "en-us",
    });
    expect(briefApi.updateBrief).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("follows up with a PUT when the recipe pins a non-default status", async () => {
    // `createBrief` accepts no status — POSTs land in 'Draft'. If the
    // recipe asks for 'Approved' the kind should converge with an
    // updateBrief call so the post-apply state matches the recipe.
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });
    briefApi.createBrief.mockResolvedValue({ ...liveBrief, id: "brief-9", status: "Draft" });
    briefApi.updateBrief.mockResolvedValue(undefined);

    const recipe = briefInstanceKind.schema.parse({
      name: "Q3 Launch",
      briefTypeName: "CreativeBrief",
      status: "Approved",
    });

    await briefInstanceKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "brief",
            summary: "create",
            meta: { stage: "instance", recipe },
          },
        ],
      },
      ref,
      ctx
    );

    expect(briefApi.updateBrief).toHaveBeenCalledOnce();
    expect(briefApi.updateBrief.mock.calls[0][2]).toEqual({ status: "Approved" });
  });

  it("throws with a helpful hint when briefTypeName resolves to nothing", async () => {
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 0, next: null, data: [] });
    const recipe = briefInstanceKind.schema.parse({
      name: "Q3 Launch",
      briefTypeName: "Missing",
    });

    await expect(
      briefInstanceKind.apply(
        {
          changes: [
            {
              kind: "create",
              path: "brief",
              summary: "create",
              meta: { stage: "instance", recipe },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow(/Brief type "Missing" not found/);
  });
});

describe("apply — update", () => {
  it("PUTs the partial patch when the brief exists", async () => {
    briefApi.listBriefs.mockResolvedValue({ totalCount: 1, next: null, data: [liveBrief] });
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });
    briefApi.updateBrief.mockResolvedValue(undefined);

    const recipe = briefInstanceKind.schema.parse({
      name: "Q3 Launch",
      briefTypeName: "CreativeBrief",
      status: "Approved",
      locale: "en-us",
    });

    const result = await briefInstanceKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "brief",
            summary: "update",
            meta: { stage: "instance", recipe },
          },
          {
            kind: "update",
            path: "brief.status",
            summary: "status",
            meta: { stage: "field", element: "status" },
          },
          {
            kind: "noop",
            path: "brief.locale",
            summary: "locale unchanged",
            meta: { stage: "field", element: "locale" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(briefApi.updateBrief).toHaveBeenCalledOnce();
    expect(briefApi.updateBrief.mock.calls[0][1]).toBe("brief-1");
    expect(briefApi.updateBrief.mock.calls[0][2]).toMatchObject({
      name: "Q3 Launch",
      status: "Approved",
      locale: "en-us",
    });
    expect(briefApi.createBrief).not.toHaveBeenCalled();
    // Lead update + per-element status update applied; the noop locale skipped.
    expect(result.applied).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
  });

  it("throws when an update targets a brief that no longer exists", async () => {
    briefApi.listBriefs.mockResolvedValue({ totalCount: 0, next: null, data: [] });
    const recipe = briefInstanceKind.schema.parse({
      name: "Q3 Launch",
      briefTypeName: "CreativeBrief",
    });
    await expect(
      briefInstanceKind.apply(
        {
          changes: [
            {
              kind: "update",
              path: "brief",
              summary: "update",
              meta: { stage: "instance", recipe },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow(/not found/);
  });

  it("refuses to repoint the brief at a different brief type", async () => {
    briefApi.listBriefs.mockResolvedValue({ totalCount: 1, next: null, data: [liveBrief] });
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });

    const recipe = briefInstanceKind.schema.parse({
      name: "Q3 Launch",
      briefTypeName: "OtherBrief",
    });

    await expect(
      briefInstanceKind.apply(
        {
          changes: [
            {
              kind: "update",
              path: "brief",
              summary: "update",
              meta: { stage: "instance", recipe },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow(/Cannot repoint/);
  });

  it("skips every change for an all-noop plan", async () => {
    const result = await briefInstanceKind.apply(
      {
        changes: [
          {
            kind: "noop",
            path: "brief.status",
            summary: "status unchanged",
            meta: { stage: "field", element: "status" },
          },
        ],
      },
      ref,
      ctx
    );
    expect(briefApi.createBrief).not.toHaveBeenCalled();
    expect(briefApi.updateBrief).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("htmlToProseMirrorDoc sanitization", () => {
  it("returns an empty doc for empty input", () => {
    expect(htmlToProseMirrorDoc("")).toEqual({ type: "doc", content: [] });
  });

  it("converts normal HTML to block paragraphs", () => {
    const doc = htmlToProseMirrorDoc("<p>Hello</p><p>World</p>");
    expect(docText(doc)).toBe("Hello\nWorld");
  });

  it("fully strips nested/malformed tags (no leftover angle brackets)", () => {
    const doc = htmlToProseMirrorDoc("<scr<script>ipt>alert()</scr<script>ipt>");
    const text = docText(doc);
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });

  it("does not double-unescape: &amp;lt; becomes &lt;, not <", () => {
    const doc = htmlToProseMirrorDoc("a &amp;lt; b");
    const text = docText(doc);
    expect(text).toContain("&lt;");
    expect(text).not.toContain("< b");
  });

  it("unescapes a single &amp; to &", () => {
    const doc = htmlToProseMirrorDoc("Tom &amp; Jerry");
    expect(docText(doc)).toBe("Tom & Jerry");
  });
});

describe("apply — campaign link convergence", () => {
  const projectId = "proj-1";
  const campaignHandle = "summer-launch@1";
  const storyId = "story-1";
  // Campaign reverse-view shapes: empty vs listing the written brief.
  const projectWithout = { id: projectId, briefs: [] as Array<{ id: string }> };
  const projectWith = { id: projectId, briefs: [{ id: "brief-9" }] };

  // Logger with error/warn spies so we can assert the link outcome is
  // surfaced loudly (the old code swallowed these to a warn).
  const makeCtx = (): {
    ctx: SyncContext;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  } => {
    const error = vi.fn();
    const warn = vi.fn();
    return {
      ctx: {
        environmentName: "test",
        logger: { info: vi.fn(), warn, error } as unknown as Logger,
      },
      error,
      warn,
    };
  };

  const applyCreateWithCampaign = (ctxArg: SyncContext) => {
    const recipe = briefInstanceKind.schema.parse({
      name: "Q3 Launch",
      briefTypeName: "CreativeBrief",
      campaignHandle,
      storyId,
    });
    return briefInstanceKind.apply(
      {
        changes: [
          { kind: "create", path: "brief", summary: "create", meta: { stage: "instance", recipe } },
        ],
      },
      ref,
      ctxArg
    );
  };

  beforeEach(() => {
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [liveType] });
    briefApi.createBrief.mockResolvedValue({ ...liveBrief, id: "brief-9", status: "Draft" });
    briefApi.updateBrief.mockResolvedValue(undefined);
    briefApi.linkBriefToProject.mockResolvedValue(undefined);
    campaignApi.listProjects.mockResolvedValue({
      next: null,
      data: [{ id: projectId, labels: [`story:${storyId}`, `handle:${campaignHandle}`] }],
    });
  });

  it("links via PATCH /links and confirms it surfaced on the campaign (no retry)", async () => {
    campaignApi.getProject.mockResolvedValue(projectWith);
    const { ctx: c, error, warn } = makeCtx();

    await applyCreateWithCampaign(c);

    expect(briefApi.linkBriefToProject).toHaveBeenCalledTimes(1);
    expect(briefApi.linkBriefToProject).toHaveBeenCalledWith(
      expect.anything(),
      "brief-9",
      projectId
    );
    // The campaign link must NOT be written through the references PUT.
    expect(briefApi.updateBrief.mock.calls.filter((call) => call[2]?.references)).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("retries the link once when it silently drops, then succeeds", async () => {
    // First reverse-view read: brief absent. After retry: present.
    campaignApi.getProject.mockResolvedValueOnce(projectWithout).mockResolvedValueOnce(projectWith);
    const { ctx: c, error, warn } = makeCtx();

    await applyCreateWithCampaign(c);

    expect(briefApi.linkBriefToProject).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/did not surface.*retrying/i));
    expect(error).not.toHaveBeenCalled();
  });

  it("logs an error when the link is STILL absent after the retry", async () => {
    campaignApi.getProject.mockResolvedValue(projectWithout); // never lists the brief
    const { ctx: c, error } = makeCtx();

    await applyCreateWithCampaign(c);

    expect(briefApi.linkBriefToProject).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/STILL absent after retry/i));
  });

  it("logs an error and does not link when no campaign matches the labels", async () => {
    campaignApi.listProjects.mockResolvedValue({ next: null, data: [] });
    const { ctx: c, error } = makeCtx();

    await applyCreateWithCampaign(c);

    expect(briefApi.linkBriefToProject).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/no campaign carrying both labels/i));
  });

  it("does not hang when listProjects returns a non-advancing pagination cursor", async () => {
    // The Orchestrate list endpoint hands back the SAME `next` cursor on
    // every page (a malformed / perpetual cursor) while never yielding a
    // matching project. Without the cursor-advance guard,
    // `findProjectIdByLabels` pages forever — each request individually
    // succeeds, so the LOOP never terminates and the whole brief push
    // hangs until the orchestrator's multi-minute spawn timeout. This is
    // the campaign-linked-brief hang (standalone briefs never page
    // projects). The guard must terminate, skip the link non-fatally
    // (the brief is still created), and warn so the cause is observable.
    //
    // If the guard regresses, this `apply` never resolves and the test
    // fails by exceeding its timeout rather than hanging the whole suite.
    campaignApi.listProjects.mockResolvedValue({
      next: "STUCK_CURSOR",
      data: [{ id: "other", labels: ["story:nomatch", "handle:nomatch"] }],
    });
    const { ctx: c, warn } = makeCtx();

    await applyCreateWithCampaign(c);

    expect(briefApi.createBrief).toHaveBeenCalledTimes(1);
    expect(briefApi.linkBriefToProject).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/non-advancing pagination cursor/i));
  }, 5_000);
});
