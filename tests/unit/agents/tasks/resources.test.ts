import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

vi.mock("../../../../src/agents/tasks/shared", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/agents/tasks/shared")>(
    "../../../../src/agents/tasks/shared"
  );
  return { ...actual, prepare: vi.fn() };
});
// `loadRecipe` is imported from `@/sync` — mock the resolved module by
// its relative path (the `@/` alias is not resolved inside `vi.mock`).
vi.mock("../../../../src/sync/index", () => ({ loadRecipe: vi.fn() }));
vi.mock("../../../../src/agents/api/custom-mcps", () => ({
  createCustomMcp: vi.fn(),
  deleteCustomMcp: vi.fn(),
  getCustomMcp: vi.fn(),
  listCustomMcps: vi.fn(),
  updateCustomMcp: vi.fn(),
}));
vi.mock("../../../../src/agents/api/html-templates", () => ({
  createHtmlTemplate: vi.fn(),
  deleteHtmlTemplate: vi.fn(),
  getHtmlTemplate: vi.fn(),
  listHtmlTemplates: vi.fn(),
  updateHtmlTemplate: vi.fn(),
}));
vi.mock("../../../../src/agents/api/schemas", () => ({
  createSchema: vi.fn(),
  deleteSchema: vi.fn(),
  getSchema: vi.fn(),
  listSchemas: vi.fn(),
  updateSchema: vi.fn(),
}));
vi.mock("../../../../src/agents/api/skills", () => ({
  createSkill: vi.fn(),
  deleteSkill: vi.fn(),
  getSkill: vi.fn(),
  listSkills: vi.fn(),
  updateSkill: vi.fn(),
}));
vi.mock("../../../../src/agents/api/widgets", () => ({
  createWidget: vi.fn(),
  deleteWidget: vi.fn(),
  getWidget: vi.fn(),
  listWidgets: vi.fn(),
  updateWidget: vi.fn(),
}));
vi.mock("../../../../src/agents/api/tools", () => ({ listTools: vi.fn() }));

import {
  htmlTemplateTasks,
  mcpTasks,
  runToolList,
  schemaTasks,
  skillTasks,
  widgetTasks,
} from "../../../../src/agents/tasks/resources";
import { prepare } from "../../../../src/agents/tasks/shared";
import { loadRecipe } from "../../../../src/sync/index";
import * as skillsApi from "../../../../src/agents/api/skills";
import * as mcpApi from "../../../../src/agents/api/custom-mcps";
import * as templatesApi from "../../../../src/agents/api/html-templates";
import * as widgetsApi from "../../../../src/agents/api/widgets";
import * as schemasApi from "../../../../src/agents/api/schemas";
import { listTools } from "../../../../src/agents/api/tools";
import { Logger } from "../../../../src/shared/logger";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

let stdout: ReturnType<typeof vi.spyOn>;
let consolaInfo: ReturnType<typeof vi.spyOn>;

const usePrepare = (json: boolean): void => {
  vi.mocked(prepare).mockResolvedValue({
    logger: new Logger(false, false, json, false),
    session: SESSION,
    envName: "test",
  } as never);
};

const jsonOut = (): unknown => {
  const raw = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));
  if (raw && typeof raw === "object" && "data" in raw) return (raw as { data: unknown }).data;
  return raw;
};
const humanLines = (): string[] => consolaInfo.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  consolaInfo = vi.spyOn(consola, "info").mockReturnValue(undefined as never);
});

afterEach(() => {
  stdout.mockRestore();
  consolaInfo.mockRestore();
});

const SKILL_RECIPE = { name: "Summarize", description: "Summarizes text", instructions: "Do it." };

describe("skillTasks — verified update + delete (skill)", () => {
  it("runList writes JSON in --json mode", async () => {
    usePrepare(true);
    vi.mocked(skillsApi.listSkills).mockResolvedValue([
      { id: "s1", slug: "summarize", name: "Summarize" },
    ] as never);

    await skillTasks.runList({} as never);

    expect(jsonOut()).toMatchObject([{ slug: "summarize" }]);
  });

  it("runList reports an empty result in human mode", async () => {
    usePrepare(false);
    vi.mocked(skillsApi.listSkills).mockResolvedValue([] as never);

    await skillTasks.runList({} as never);

    expect(humanLines().some((l) => l.includes("No skill(s) found"))).toBe(true);
  });

  it("runList renders a slug-padded line per skill in human mode", async () => {
    usePrepare(false);
    vi.mocked(skillsApi.listSkills).mockResolvedValue([
      { id: "s1", slug: "summarize", name: "Summarize" },
    ] as never);

    await skillTasks.runList({} as never);

    expect(humanLines().some((l) => l.includes("summarize") && l.includes("Summarize"))).toBe(true);
  });

  it("runCreate reports a created skill in human mode (green line)", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(SKILL_RECIPE as never);
    vi.mocked(skillsApi.getSkill).mockResolvedValue(undefined as never);
    vi.mocked(skillsApi.createSkill).mockResolvedValue({ id: "s1" } as never);

    await skillTasks.runCreate({ file: "s.yaml" } as never);

    expect(humanLines().some((l) => l.includes("Created skill"))).toBe(true);
  });

  it("runGet throws INPUT_INVALID when the skill is not found", async () => {
    usePrepare(false);
    vi.mocked(skillsApi.getSkill).mockResolvedValue(undefined as never);

    await expect(skillTasks.runGet({ idOrName: "ghost" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("runGet renders the matched skill", async () => {
    usePrepare(true);
    vi.mocked(skillsApi.getSkill).mockResolvedValue({
      id: "s1",
      name: "Summarize",
      slug: "summarize",
    } as never);

    await skillTasks.runGet({ idOrName: "summarize" } as never);

    expect(jsonOut()).toMatchObject({ id: "s1" });
  });

  it("runCreate throws INPUT_INVALID when a skill of that name already exists", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(SKILL_RECIPE as never);
    vi.mocked(skillsApi.getSkill).mockResolvedValue({ id: "s1", name: "Summarize" } as never);

    await expect(skillTasks.runCreate({ file: "s.yaml" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(skillsApi.createSkill).not.toHaveBeenCalled();
  });

  it("runCreate plans without calling the API in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(SKILL_RECIPE as never);
    vi.mocked(skillsApi.getSkill).mockResolvedValue(undefined as never);

    await skillTasks.runCreate({ file: "s.yaml", whatIf: true } as never);

    expect(jsonOut()).toMatchObject({ plan: { create: "Summarize" } });
    expect(skillsApi.createSkill).not.toHaveBeenCalled();
  });

  it("runCreate creates the skill when the name is free", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(SKILL_RECIPE as never);
    vi.mocked(skillsApi.getSkill).mockResolvedValue(undefined as never);
    vi.mocked(skillsApi.createSkill).mockResolvedValue({ id: "s1" } as never);

    await skillTasks.runCreate({ file: "s.yaml" } as never);

    expect(skillsApi.createSkill).toHaveBeenCalledWith(SESSION, SKILL_RECIPE);
    expect(jsonOut()).toMatchObject({ ok: true });
  });

  it("runUpdate does NOT require --unverified (skill update is verified)", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(SKILL_RECIPE as never);
    vi.mocked(skillsApi.getSkill).mockResolvedValue({ id: "s1", name: "Summarize" } as never);
    vi.mocked(skillsApi.updateSkill).mockResolvedValue(undefined as never);

    await skillTasks.runUpdate({ idOrName: "summarize", file: "s.yaml" } as never);

    expect(skillsApi.updateSkill).toHaveBeenCalledWith(SESSION, { id: "s1", ...SKILL_RECIPE });
    expect(jsonOut()).toMatchObject({ updated: "s1" });
  });

  it("runUpdate plans without writing in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(SKILL_RECIPE as never);
    vi.mocked(skillsApi.getSkill).mockResolvedValue({ id: "s1", name: "Summarize" } as never);

    await skillTasks.runUpdate({ idOrName: "summarize", file: "s.yaml", whatIf: true } as never);

    expect(jsonOut()).toMatchObject({ plan: { update: "s1" } });
    expect(skillsApi.updateSkill).not.toHaveBeenCalled();
  });

  it("runUpdate throws INPUT_INVALID when the skill to update is missing", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(SKILL_RECIPE as never);
    vi.mocked(skillsApi.getSkill).mockResolvedValue(undefined as never);

    await expect(
      skillTasks.runUpdate({ idOrName: "ghost", file: "s.yaml" } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("runDelete deletes the skill (verified) without --unverified", async () => {
    usePrepare(true);
    vi.mocked(skillsApi.getSkill).mockResolvedValue({ id: "s1", name: "Summarize" } as never);
    vi.mocked(skillsApi.deleteSkill).mockResolvedValue(undefined as never);

    await skillTasks.runDelete({ idOrName: "summarize" } as never);

    expect(skillsApi.deleteSkill).toHaveBeenCalledWith(SESSION, "s1");
    expect(jsonOut()).toMatchObject({ deleted: "s1" });
  });

  it("runDelete plans without writing in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(skillsApi.getSkill).mockResolvedValue({ id: "s1", name: "Summarize" } as never);

    await skillTasks.runDelete({ idOrName: "summarize", whatIf: true } as never);

    expect(jsonOut()).toMatchObject({ plan: { delete: "s1" } });
    expect(skillsApi.deleteSkill).not.toHaveBeenCalled();
  });
});

describe("mcpTasks — unverified update gate (custom MCP)", () => {
  it("exposes updateVerified=false / deleteVerified=true", () => {
    expect(mcpTasks.updateVerified).toBe(false);
    expect(mcpTasks.deleteVerified).toBe(true);
  });

  it("runUpdate throws INPUT_INVALID when --unverified is absent (update is unverified)", async () => {
    usePrepare(false);

    await expect(
      mcpTasks.runUpdate({ idOrName: "m1", file: "m.yaml" } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    // The gate fires before `prepare` / `loadRecipe`.
    expect(prepare).not.toHaveBeenCalled();
    expect(loadRecipe).not.toHaveBeenCalled();
  });

  it("runUpdate proceeds past the gate when --unverified is set", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ name: "Local MCP", url: "http://x" } as never);
    vi.mocked(mcpApi.getCustomMcp).mockResolvedValue({ id: "m1", name: "Local MCP" } as never);
    vi.mocked(mcpApi.updateCustomMcp).mockResolvedValue(undefined as never);

    await mcpTasks.runUpdate({ idOrName: "Local MCP", file: "m.yaml", unverified: true } as never);

    expect(mcpApi.updateCustomMcp).toHaveBeenCalledWith(SESSION, {
      id: "m1",
      name: "Local MCP",
      url: "http://x",
    });
  });

  it("runDelete does NOT require --unverified (delete is verified for mcp)", async () => {
    usePrepare(true);
    vi.mocked(mcpApi.getCustomMcp).mockResolvedValue({ id: "m1", name: "Local MCP" } as never);
    vi.mocked(mcpApi.deleteCustomMcp).mockResolvedValue(undefined as never);

    await mcpTasks.runDelete({ idOrName: "Local MCP" } as never);

    expect(mcpApi.deleteCustomMcp).toHaveBeenCalledWith(SESSION, "m1");
    expect(jsonOut()).toMatchObject({ deleted: "m1" });
  });

  it("runList renders a name + url line per custom MCP in human mode", async () => {
    usePrepare(false);
    vi.mocked(mcpApi.listCustomMcps).mockResolvedValue([
      { id: "m1", name: "Local MCP", url: "http://localhost:3000" },
    ] as never);

    await mcpTasks.runList({} as never);

    expect(humanLines().some((l) => l.includes("Local MCP") && l.includes("localhost:3000"))).toBe(
      true
    );
  });

  it("runCreate forwards the recipe to createCustomMcp when the name is free", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ name: "Local MCP", url: "http://x" } as never);
    vi.mocked(mcpApi.getCustomMcp).mockResolvedValue(undefined as never);
    vi.mocked(mcpApi.createCustomMcp).mockResolvedValue({ id: "m1" } as never);

    await mcpTasks.runCreate({ file: "m.yaml" } as never);

    expect(mcpApi.createCustomMcp).toHaveBeenCalledWith(SESSION, {
      name: "Local MCP",
      url: "http://x",
    });
    expect(jsonOut()).toMatchObject({ ok: true });
  });
});

describe("schemaTasks — verified update / unverified delete", () => {
  it("exposes updateVerified=true / deleteVerified=false", () => {
    expect(schemaTasks.updateVerified).toBe(true);
    expect(schemaTasks.deleteVerified).toBe(false);
  });

  it("runDelete throws INPUT_INVALID when --unverified is absent (schema delete is unverified)", async () => {
    usePrepare(false);

    await expect(schemaTasks.runDelete({ idOrName: "sc1" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("htmlTemplateTasks — resolveById path (no list endpoint)", () => {
  it("runUpdate treats idOrName as the id directly, skipping a find lookup", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ name: "Card", html: "<div/>" } as never);
    vi.mocked(templatesApi.updateHtmlTemplate).mockResolvedValue(undefined as never);

    await htmlTemplateTasks.runUpdate({
      idOrName: "tpl-id-7",
      file: "t.yaml",
      unverified: true,
    } as never);

    // resolveById → no getHtmlTemplate lookup, id passed straight through.
    expect(templatesApi.getHtmlTemplate).not.toHaveBeenCalled();
    expect(templatesApi.updateHtmlTemplate).toHaveBeenCalledWith(SESSION, {
      id: "tpl-id-7",
      name: "Card",
      html: "<div/>",
    });
  });

  it("runDelete treats idOrName as the id directly", async () => {
    usePrepare(true);
    vi.mocked(templatesApi.deleteHtmlTemplate).mockResolvedValue(undefined as never);

    await htmlTemplateTasks.runDelete({ idOrName: "tpl-id-7", unverified: true } as never);

    expect(templatesApi.getHtmlTemplate).not.toHaveBeenCalled();
    expect(templatesApi.deleteHtmlTemplate).toHaveBeenCalledWith(SESSION, "tpl-id-7");
    expect(jsonOut()).toMatchObject({ deleted: "tpl-id-7" });
  });
});

describe("runToolList — read-only tool catalog", () => {
  it("writes the tool list as JSON in --json mode", async () => {
    usePrepare(true);
    vi.mocked(listTools).mockResolvedValue([
      { toolKey: "web.search", category: "research", label: "Web Search" },
    ] as never);

    await runToolList({} as never);

    expect(jsonOut()).toMatchObject([{ toolKey: "web.search" }]);
  });

  it("renders a human line per tool", async () => {
    usePrepare(false);
    vi.mocked(listTools).mockResolvedValue([
      { toolKey: "web.search", category: "research", label: "Web Search" },
    ] as never);

    await runToolList({} as never);

    expect(humanLines().some((l) => l.includes("web.search"))).toBe(true);
  });
});

describe("widgetTasks — create gate", () => {
  it("widget update + delete are both verified", () => {
    expect(widgetTasks.updateVerified).toBe(true);
    expect(widgetTasks.deleteVerified).toBe(true);
  });
});

const WIDGET_RECIPE = { name: "Sales Dashboard", config: { metric: "revenue" } };

describe("widgetTasks — full CRUD runners", () => {
  it("runList renders widget lines in human mode", async () => {
    usePrepare(false);
    vi.mocked(widgetsApi.listWidgets).mockResolvedValue([
      { id: "w1", name: "Sales Dashboard" },
    ] as never);

    await widgetTasks.runList({} as never);

    expect(humanLines().some((l) => l.includes("Sales Dashboard"))).toBe(true);
  });

  it("runGet throws INPUT_INVALID when the widget is missing", async () => {
    usePrepare(false);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue(undefined as never);

    await expect(widgetTasks.runGet({ idOrName: "ghost" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("runCreate creates the widget when the name is free", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue(WIDGET_RECIPE as never);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue(undefined as never);
    vi.mocked(widgetsApi.createWidget).mockResolvedValue({ id: "w1" } as never);

    await widgetTasks.runCreate({ file: "w.yaml" } as never);

    expect(widgetsApi.createWidget).toHaveBeenCalledWith(SESSION, WIDGET_RECIPE);
    expect(jsonOut()).toMatchObject({ ok: true });
  });

  it("runCreate plans the create in human --what-if mode (yellow line)", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(WIDGET_RECIPE as never);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue(undefined as never);

    await widgetTasks.runCreate({ file: "w.yaml", whatIf: true } as never);

    expect(humanLines().some((l) => l.includes("Would create widget"))).toBe(true);
    expect(widgetsApi.createWidget).not.toHaveBeenCalled();
  });

  it("runUpdate applies the update in human mode (verified — no gate)", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(WIDGET_RECIPE as never);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue({
      id: "w1",
      name: "Sales Dashboard",
    } as never);
    vi.mocked(widgetsApi.updateWidget).mockResolvedValue(undefined as never);

    await widgetTasks.runUpdate({ idOrName: "Sales Dashboard", file: "w.yaml" } as never);

    expect(widgetsApi.updateWidget).toHaveBeenCalledWith(SESSION, { id: "w1", ...WIDGET_RECIPE });
    expect(humanLines().some((l) => l.includes("Updated widget"))).toBe(true);
  });

  it("runUpdate plans the update in human --what-if mode", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue(WIDGET_RECIPE as never);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue({
      id: "w1",
      name: "Sales Dashboard",
    } as never);

    await widgetTasks.runUpdate({
      idOrName: "Sales Dashboard",
      file: "w.yaml",
      whatIf: true,
    } as never);

    expect(humanLines().some((l) => l.includes("Would update widget"))).toBe(true);
    expect(widgetsApi.updateWidget).not.toHaveBeenCalled();
  });

  it("runDelete deletes the widget in human mode", async () => {
    usePrepare(false);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue({
      id: "w1",
      name: "Sales Dashboard",
    } as never);
    vi.mocked(widgetsApi.deleteWidget).mockResolvedValue(undefined as never);

    await widgetTasks.runDelete({ idOrName: "Sales Dashboard" } as never);

    expect(widgetsApi.deleteWidget).toHaveBeenCalledWith(SESSION, "w1");
    expect(humanLines().some((l) => l.includes("Deleted widget"))).toBe(true);
  });

  it("runDelete plans the delete in human --what-if mode", async () => {
    usePrepare(false);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue({
      id: "w1",
      name: "Sales Dashboard",
    } as never);

    await widgetTasks.runDelete({ idOrName: "Sales Dashboard", whatIf: true } as never);

    expect(humanLines().some((l) => l.includes("Would delete widget"))).toBe(true);
    expect(widgetsApi.deleteWidget).not.toHaveBeenCalled();
  });

  it("runDelete throws INPUT_INVALID when the widget to delete is missing", async () => {
    usePrepare(false);
    vi.mocked(widgetsApi.getWidget).mockResolvedValue(undefined as never);

    await expect(widgetTasks.runDelete({ idOrName: "ghost" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("schemaTasks — identify fallbacks + delete gate", () => {
  it("runList uses the schemaId fallback when `id` is absent", async () => {
    usePrepare(false);
    vi.mocked(schemasApi.listSchemas).mockResolvedValue([
      { schemaId: "sc-7", name: "OutputSchema" },
    ] as never);

    await schemaTasks.runList({} as never);

    expect(humanLines().some((l) => l.includes("sc-7"))).toBe(true);
  });

  it("runGet identifies the schema by its name when id/schemaId are absent", async () => {
    usePrepare(true);
    vi.mocked(schemasApi.getSchema).mockResolvedValue({ name: "OutputSchema" } as never);

    await schemaTasks.runGet({ idOrName: "OutputSchema" } as never);

    expect(jsonOut()).toMatchObject({ name: "OutputSchema" });
  });

  it("runUpdate updates the schema (verified) using the schemaId identity", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ name: "OutputSchema" } as never);
    vi.mocked(schemasApi.getSchema).mockResolvedValue({
      schemaId: "sc-7",
      name: "OutputSchema",
    } as never);
    vi.mocked(schemasApi.updateSchema).mockResolvedValue(undefined as never);

    await schemaTasks.runUpdate({ idOrName: "OutputSchema", file: "sc.yaml" } as never);

    expect(schemasApi.updateSchema).toHaveBeenCalledWith(SESSION, {
      id: "sc-7",
      name: "OutputSchema",
    });
    expect(jsonOut()).toMatchObject({ updated: "sc-7" });
  });

  it("runDelete proceeds past the gate when --unverified is set", async () => {
    usePrepare(true);
    vi.mocked(schemasApi.getSchema).mockResolvedValue({
      id: "sc-7",
      name: "OutputSchema",
    } as never);
    vi.mocked(schemasApi.deleteSchema).mockResolvedValue(undefined as never);

    await schemaTasks.runDelete({ idOrName: "OutputSchema", unverified: true } as never);

    expect(schemasApi.deleteSchema).toHaveBeenCalledWith(SESSION, "sc-7");
    expect(jsonOut()).toMatchObject({ deleted: "sc-7" });
  });

  it("runCreate forwards the recipe to createSchema when the name is free", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ name: "OutputSchema" } as never);
    vi.mocked(schemasApi.getSchema).mockResolvedValue(undefined as never);
    vi.mocked(schemasApi.createSchema).mockResolvedValue({ id: "sc-7" } as never);

    await schemaTasks.runCreate({ file: "sc.yaml" } as never);

    expect(schemasApi.createSchema).toHaveBeenCalledWith(SESSION, { name: "OutputSchema" });
    expect(jsonOut()).toMatchObject({ ok: true });
  });
});

describe("htmlTemplateTasks — read-side runners", () => {
  it("runList renders the templateId fallback label when name is absent", async () => {
    usePrepare(false);
    vi.mocked(templatesApi.listHtmlTemplates).mockResolvedValue([
      { id: "tpl-1", templateId: "card-template" },
    ] as never);

    await htmlTemplateTasks.runList({} as never);

    expect(humanLines().some((l) => l.includes("card-template"))).toBe(true);
  });

  it("runGet identifies the template by name", async () => {
    usePrepare(true);
    vi.mocked(templatesApi.getHtmlTemplate).mockResolvedValue({
      id: "tpl-1",
      name: "Card",
    } as never);

    await htmlTemplateTasks.runGet({ idOrName: "tpl-1" } as never);

    expect(jsonOut()).toMatchObject({ id: "tpl-1" });
  });

  it("runGet throws INPUT_INVALID when the template is missing", async () => {
    usePrepare(false);
    vi.mocked(templatesApi.getHtmlTemplate).mockResolvedValue(undefined as never);

    await expect(htmlTemplateTasks.runGet({ idOrName: "ghost" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("runCreate creates a template when the name is free", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ name: "Card", html: "<div/>" } as never);
    vi.mocked(templatesApi.getHtmlTemplate).mockResolvedValue(undefined as never);
    vi.mocked(templatesApi.createHtmlTemplate).mockResolvedValue({ id: "tpl-1" } as never);

    await htmlTemplateTasks.runCreate({ file: "t.yaml" } as never);

    expect(templatesApi.createHtmlTemplate).toHaveBeenCalledOnce();
    expect(jsonOut()).toMatchObject({ ok: true });
  });

  it("runUpdate throws INPUT_INVALID when --unverified is absent (html-template update is unverified)", async () => {
    usePrepare(false);

    await expect(
      htmlTemplateTasks.runUpdate({ idOrName: "tpl-1", file: "t.yaml" } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("runDelete throws INPUT_INVALID when --unverified is absent", async () => {
    usePrepare(false);

    await expect(htmlTemplateTasks.runDelete({ idOrName: "tpl-1" } as never)).rejects.toMatchObject(
      { code: "INPUT_INVALID" }
    );
  });

  it("runUpdate plans the update in human --what-if mode (resolveById)", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue({ name: "Card", html: "<div/>" } as never);

    await htmlTemplateTasks.runUpdate({
      idOrName: "tpl-id-7",
      file: "t.yaml",
      unverified: true,
      whatIf: true,
    } as never);

    expect(humanLines().some((l) => l.includes("Would update html-template"))).toBe(true);
    expect(templatesApi.updateHtmlTemplate).not.toHaveBeenCalled();
  });

  it("runDelete plans the delete in human --what-if mode (resolveById)", async () => {
    usePrepare(false);

    await htmlTemplateTasks.runDelete({
      idOrName: "tpl-id-7",
      unverified: true,
      whatIf: true,
    } as never);

    expect(humanLines().some((l) => l.includes("Would delete html-template"))).toBe(true);
    expect(templatesApi.deleteHtmlTemplate).not.toHaveBeenCalled();
  });
});
