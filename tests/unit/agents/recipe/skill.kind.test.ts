import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → session bridge so the kind never reads real config or
// touches the keychain. `skill.kind.ts` imports `resolveAgentsSession`
// from `./client` — i.e. src/agents/recipe/client.ts.
const resolveAgentsSession = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/agents/recipe/client", () => ({ resolveAgentsSession }));

// Mock the skills API surface the kind composes.
const skillsApi = vi.hoisted(() => ({
  createSkill: vi.fn(),
  listSkills: vi.fn(),
}));
vi.mock("../../../../src/agents/api/skills", () => skillsApi);

import { skillKind } from "../../../../src/agents/recipe/skill.kind";
import { SkillRecipeSchema } from "../../../../src/agents/recipe/skill.schema";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "skill", id: "Tone of voice" } as const;

const recipe = (input: unknown) => SkillRecipeSchema.parse(input);

const makeSkill = (overrides: Record<string, unknown> = {}) => ({
  id: "skill-id-1",
  slug: "tone-of-voice",
  name: "Tone of voice",
  description: "How the brand speaks",
  content: "Be warm.",
  tags: ["brand"],
  visibility: "team",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveAgentsSession.mockResolvedValue(SESSION);
});

describe("skillKind — recipe-kind contract", () => {
  it("exposes the name, schema, and the three operations", () => {
    expect(skillKind.name).toBe("skill");
    expect(skillKind.schema).toBe(SkillRecipeSchema);
    expect(typeof skillKind.readCurrent).toBe("function");
    expect(typeof skillKind.plan).toBe("function");
    expect(typeof skillKind.apply).toBe("function");
  });
});

describe("skillKind.readCurrent", () => {
  it("returns null when no skill matches the ref name or slug", async () => {
    skillsApi.listSkills.mockResolvedValue([makeSkill({ name: "Other", slug: "other" })]);

    expect(await skillKind.readCurrent(ref, ctx)).toBeNull();
  });

  it("projects a live skill into the recipe shape", async () => {
    skillsApi.listSkills.mockResolvedValue([makeSkill()]);

    const result = await skillKind.readCurrent(ref, ctx);

    expect(result).toEqual({
      name: "Tone of voice",
      description: "How the brand speaks",
      content: "Be warm.",
      tags: ["brand"],
      visibility: "team",
    });
  });

  it("matches a skill by slug when the ref id is the slug, not the display name", async () => {
    skillsApi.listSkills.mockResolvedValue([
      makeSkill({ name: "Different Name", slug: "tone-of-voice" }),
    ]);

    const result = await skillKind.readCurrent({ kind: "skill", id: "tone-of-voice" }, ctx);

    expect(result?.name).toBe("Different Name");
  });

  it("defaults content to an empty string when the live skill omits it", async () => {
    skillsApi.listSkills.mockResolvedValue([makeSkill({ content: undefined })]);

    const result = await skillKind.readCurrent(ref, ctx);

    expect(result?.content).toBe("");
  });

  it("defaults tags to an empty array when the live skill omits them", async () => {
    skillsApi.listSkills.mockResolvedValue([makeSkill({ tags: undefined })]);

    const result = await skillKind.readCurrent(ref, ctx);

    expect(result?.tags).toEqual([]);
  });

  it("defaults visibility to team when the live skill omits it", async () => {
    skillsApi.listSkills.mockResolvedValue([makeSkill({ visibility: undefined })]);

    const result = await skillKind.readCurrent(ref, ctx);

    expect(result?.visibility).toBe("team");
  });
});

describe("skillKind.plan", () => {
  it("plans a create when the skill does not exist remotely", async () => {
    skillsApi.listSkills.mockResolvedValue([]);

    const plan = await skillKind.plan(
      recipe({ name: "Tone of voice", description: "d", content: "c" }),
      ref,
      ctx
    );

    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "skill.Tone of voice" });
    expect(plan.changes[0].meta?.recipe).toMatchObject({ name: "Tone of voice" });
  });

  it("plans a noop when the skill already exists — create-only kind", async () => {
    skillsApi.listSkills.mockResolvedValue([makeSkill()]);

    const plan = await skillKind.plan(
      recipe({ name: "Tone of voice", description: "d", content: "changed" }),
      ref,
      ctx
    );

    expect(plan.changes[0].kind).toBe("noop");
  });
});

describe("skillKind.apply — noop / empty plan", () => {
  it("returns nothing applied and nothing skipped for an empty plan", async () => {
    const result = await skillKind.apply({ changes: [] }, ref, ctx);

    expect(result).toEqual({ applied: [], skipped: [] });
    expect(skillsApi.createSkill).not.toHaveBeenCalled();
  });

  it("skips a noop change without touching the API", async () => {
    const result = await skillKind.apply(
      { changes: [{ kind: "noop", path: "skill.Tone of voice", summary: "exists" }] },
      ref,
      ctx
    );

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(skillsApi.createSkill).not.toHaveBeenCalled();
  });
});

describe("skillKind.apply — create", () => {
  it("creates the skill from the change's meta.recipe", async () => {
    skillsApi.createSkill.mockResolvedValue(makeSkill());

    const result = await skillKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "skill.Tone of voice",
            summary: "create skill",
            meta: {
              recipe: recipe({ name: "Tone of voice", description: "d", content: "c" }),
            },
          },
        ],
      },
      ref,
      ctx
    );

    expect(skillsApi.createSkill).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ name: "Tone of voice", content: "c" })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("falls back to parsing change.after when meta.recipe is absent", async () => {
    skillsApi.createSkill.mockResolvedValue(makeSkill());

    await skillKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "skill.Tone of voice",
            summary: "create skill",
            after: { name: "Tone of voice", description: "d", content: "from after" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(skillsApi.createSkill).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ content: "from after", visibility: "team" })
    );
  });

  it("throws when change.after is invalid (missing content) and no meta.recipe is present", async () => {
    await expect(
      skillKind.apply(
        {
          changes: [
            {
              kind: "create",
              path: "skill.Tone of voice",
              summary: "create skill",
              after: { name: "Tone of voice", description: "d" },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow();
    expect(skillsApi.createSkill).not.toHaveBeenCalled();
  });
});
