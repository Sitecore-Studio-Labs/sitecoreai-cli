import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → session bridge so the kind never reads real config or
// touches the keychain. `html-template.kind.ts` imports `resolveAgentsSession`
// from `./client` — i.e. src/agents/recipe/client.ts.
const resolveAgentsSession = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/agents/recipe/client", () => ({ resolveAgentsSession }));

// Mock the html-template API surface the kind composes.
const htmlTemplatesApi = vi.hoisted(() => ({
  createHtmlTemplate: vi.fn(),
  listHtmlTemplates: vi.fn(),
}));
vi.mock("../../../../src/agents/api/html-templates", () => htmlTemplatesApi);

import { htmlTemplateKind } from "../../../../src/agents/recipe/html-template.kind";
import { HtmlTemplateRecipeSchema } from "../../../../src/agents/recipe/html-template.schema";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "html-template", id: "Report" } as const;

const recipe = (input: unknown) => HtmlTemplateRecipeSchema.parse(input);

const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
  id: "tmpl-id-1",
  templateId: "tmpl-1",
  name: "Report",
  code: "<h1>Report</h1>",
  description: "A report template",
  tags: ["docs"],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveAgentsSession.mockResolvedValue(SESSION);
});

describe("htmlTemplateKind — recipe-kind contract", () => {
  it("exposes the name, schema, and the three operations", () => {
    expect(htmlTemplateKind.name).toBe("html-template");
    expect(htmlTemplateKind.schema).toBe(HtmlTemplateRecipeSchema);
    expect(typeof htmlTemplateKind.readCurrent).toBe("function");
    expect(typeof htmlTemplateKind.plan).toBe("function");
    expect(typeof htmlTemplateKind.apply).toBe("function");
  });
});

describe("htmlTemplateKind.readCurrent", () => {
  it("returns null when no template matches the ref name", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([
      makeTemplate({ name: "Other", templateId: "other" }),
    ]);

    expect(await htmlTemplateKind.readCurrent(ref, ctx)).toBeNull();
  });

  it("projects a live template into the recipe shape", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([makeTemplate()]);

    const result = await htmlTemplateKind.readCurrent(ref, ctx);

    expect(result).toEqual({
      name: "Report",
      code: "<h1>Report</h1>",
      description: "A report template",
      tags: ["docs"],
    });
  });

  it("matches a template by templateId when the ref id is the templateId, not the name", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([
      makeTemplate({ name: "Different Name", templateId: "tmpl-1" }),
    ]);

    const result = await htmlTemplateKind.readCurrent({ kind: "html-template", id: "tmpl-1" }, ctx);

    expect(result?.name).toBe("Different Name");
  });

  it("falls back to templateId for the recipe name when the template has no name", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([
      makeTemplate({ name: undefined, templateId: "tmpl-1" }),
    ]);

    const result = await htmlTemplateKind.readCurrent({ kind: "html-template", id: "tmpl-1" }, ctx);

    expect(result?.name).toBe("tmpl-1");
  });

  it("falls back to the ref id for the recipe name when name and templateId are both absent", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([
      // matched on templateId === ref.id, then name resolves to ref.id.
      makeTemplate({ name: undefined, templateId: "Report" }),
    ]);

    const result = await htmlTemplateKind.readCurrent(ref, ctx);

    expect(result?.name).toBe("Report");
  });

  it("defaults code to an empty string when the live template omits it", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([makeTemplate({ code: undefined })]);

    const result = await htmlTemplateKind.readCurrent(ref, ctx);

    expect(result?.code).toBe("");
  });

  it("defaults tags to an empty array when the live template omits them", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([makeTemplate({ tags: undefined })]);

    const result = await htmlTemplateKind.readCurrent(ref, ctx);

    expect(result?.tags).toEqual([]);
  });
});

describe("htmlTemplateKind.plan", () => {
  it("plans a create when the template does not exist remotely", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([]);

    const plan = await htmlTemplateKind.plan(recipe({ name: "Report", code: "<p/>" }), ref, ctx);

    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "html-template.Report" });
    expect(plan.changes[0].meta?.recipe).toMatchObject({ name: "Report" });
  });

  it("plans a noop when the template already exists — create-only kind", async () => {
    htmlTemplatesApi.listHtmlTemplates.mockResolvedValue([makeTemplate()]);

    const plan = await htmlTemplateKind.plan(
      recipe({ name: "Report", code: "<p>changed</p>" }),
      ref,
      ctx
    );

    expect(plan.changes[0].kind).toBe("noop");
  });
});

describe("htmlTemplateKind.apply — noop / empty plan", () => {
  it("returns nothing applied and nothing skipped for an empty plan", async () => {
    const result = await htmlTemplateKind.apply({ changes: [] }, ref, ctx);

    expect(result).toEqual({ applied: [], skipped: [] });
    expect(htmlTemplatesApi.createHtmlTemplate).not.toHaveBeenCalled();
  });

  it("skips a noop change without touching the API", async () => {
    const result = await htmlTemplateKind.apply(
      { changes: [{ kind: "noop", path: "html-template.Report", summary: "exists" }] },
      ref,
      ctx
    );

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(htmlTemplatesApi.createHtmlTemplate).not.toHaveBeenCalled();
  });
});

describe("htmlTemplateKind.apply — create", () => {
  it("creates the template from the change's meta.recipe", async () => {
    htmlTemplatesApi.createHtmlTemplate.mockResolvedValue(makeTemplate());

    const result = await htmlTemplateKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "html-template.Report",
            summary: "create html-template",
            meta: { recipe: recipe({ name: "Report", code: "<b>hi</b>" }) },
          },
        ],
      },
      ref,
      ctx
    );

    expect(htmlTemplatesApi.createHtmlTemplate).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ name: "Report", code: "<b>hi</b>" })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("falls back to parsing change.after when meta.recipe is absent", async () => {
    htmlTemplatesApi.createHtmlTemplate.mockResolvedValue(makeTemplate());

    await htmlTemplateKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "html-template.Report",
            summary: "create html-template",
            after: { name: "Report", code: "<i>from after</i>" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(htmlTemplatesApi.createHtmlTemplate).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ code: "<i>from after</i>", tags: [] })
    );
  });

  it("throws when change.after is invalid (missing name) and no meta.recipe is present", async () => {
    await expect(
      htmlTemplateKind.apply(
        {
          changes: [
            {
              kind: "create",
              path: "html-template.Report",
              summary: "create html-template",
              after: { code: "<p/>" },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow();
    expect(htmlTemplatesApi.createHtmlTemplate).not.toHaveBeenCalled();
  });
});
