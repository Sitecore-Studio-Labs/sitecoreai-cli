import { describe, expect, it } from "vitest";
import { BrandKitRecipeSchema } from "../../../../src/brand/recipe/schema";
import { diffBrandKit } from "../../../../src/brand/recipe/diff";

const recipe = (input: unknown) => BrandKitRecipeSchema.parse(input);

describe("diffBrandKit — kit absent", () => {
  it("plans kit creation plus one ingest per document", () => {
    const desired = recipe({
      name: "Acme",
      documents: [{ url: "https://x.test/a.pdf" }, { url: "https://x.test/b.pdf" }],
    });
    const plan = diffBrandKit(desired, null);
    expect(plan.changes.map((change) => [change.kind, change.path])).toEqual([
      ["create", "kit"],
      ["create", "documents[0]"],
      ["create", "documents[1]"],
    ]);
  });

  it("labels a registry-file document by path in the summary, not by url", () => {
    const desired = recipe({
      name: "Acme",
      documents: [{ kind: "registry-file", path: "brand-docs/voice.pdf" }],
    });
    const plan = diffBrandKit(desired, null);
    const docChange = plan.changes.find((change) => change.path === "documents[0]");
    expect(docChange?.summary).toContain("registry-file:brand-docs/voice.pdf");
    expect(docChange?.after).toBe("registry-file:brand-docs/voice.pdf");
  });

  it("plans just kit creation when there are no documents or sections", () => {
    const plan = diffBrandKit(recipe({ name: "Acme" }), null);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "kit", after: "Acme" });
  });

  it("emits desired field values as create changes (resolved after enrichment)", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sections: { "Tone of Voice": { Voice: "Confident" } } }),
      null
    );
    expect(plan.changes.map((change) => [change.kind, change.path])).toEqual([
      ["create", "kit"],
      ["create", "sections.Tone of Voice.Voice"],
    ]);
    expect(plan.changes[1].meta).toMatchObject({
      stage: "field",
      section: "Tone of Voice",
      field: "Voice",
    });
  });
});

describe("diffBrandKit — kit present", () => {
  const current = recipe({
    name: "Acme",
    sections: { "Tone of Voice": { Voice: "Old voice", Personality: ["Bold"] } },
  });

  it("marks unchanged fields as noop", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sections: { "Tone of Voice": { Voice: "Old voice" } } }),
      current
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      kind: "noop",
      path: "sections.Tone of Voice.Voice",
    });
  });

  it("marks changed fields as update with before/after", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sections: { "Tone of Voice": { Voice: "New voice" } } }),
      current
    );
    expect(plan.changes[0]).toMatchObject({
      kind: "update",
      path: "sections.Tone of Voice.Voice",
      before: "Old voice",
      after: "New voice",
    });
  });

  it("flags a field absent on the kit as a create change", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sections: { "Tone of Voice": { Missing: "x" } } }),
      current
    );
    expect(plan.changes[0]).toMatchObject({
      kind: "create",
      path: "sections.Tone of Voice.Missing",
    });
  });

  it("diffs list values structurally", () => {
    const same = diffBrandKit(
      recipe({ name: "Acme", sections: { "Tone of Voice": { Personality: ["Bold"] } } }),
      current
    );
    expect(same.changes[0].kind).toBe("noop");

    const changed = diffBrandKit(
      recipe({ name: "Acme", sections: { "Tone of Voice": { Personality: ["Bold", "Calm"] } } }),
      current
    );
    expect(changed.changes[0].kind).toBe("update");
  });

  it("never emits kit-lifecycle changes for an existing kit", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sections: { "Tone of Voice": { Voice: "x" } } }),
      current
    );
    expect(plan.changes.some((change) => change.meta?.stage === "kit")).toBe(false);
  });
});
