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
    sections: { "Tone of Voice": { Voice: "Old voice", Personality: [{ name: "Bold" }] } },
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
      recipe({ name: "Acme", sections: { "Tone of Voice": { Personality: [{ name: "Bold" }] } } }),
      current
    );
    expect(same.changes[0].kind).toBe("noop");

    const changed = diffBrandKit(
      recipe({
        name: "Acme",
        sections: { "Tone of Voice": { Personality: [{ name: "Bold" }, { name: "Calm" }] } },
      }),
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

describe("diffBrandKit — logo", () => {
  const logo = "https://cdn.test/logo.png";

  it("plans a logo change on create when the recipe declares one", () => {
    const plan = diffBrandKit(recipe({ name: "Acme", logo }), null);
    const change = plan.changes.find((c) => c.meta?.stage === "logo");
    expect(change).toMatchObject({ kind: "create", path: "logo", after: logo });
  });

  it("plans a logo update when the live logo differs", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", logo }),
      recipe({ name: "Acme", logo: "https://cdn.test/old.png" })
    );
    expect(plan.changes.find((c) => c.meta?.stage === "logo")).toMatchObject({
      kind: "update",
      path: "logo",
      before: "https://cdn.test/old.png",
      after: logo,
    });
  });

  it("emits no logo change when the logo is unchanged (idempotent)", () => {
    const plan = diffBrandKit(recipe({ name: "Acme", logo }), recipe({ name: "Acme", logo }));
    expect(plan.changes.some((c) => c.meta?.stage === "logo")).toBe(false);
  });

  it("leaves the live logo unmanaged when the recipe omits it", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme" }),
      recipe({ name: "Acme", logo: "https://cdn.test/keep.png" })
    );
    expect(plan.changes.some((c) => c.meta?.stage === "logo")).toBe(false);
  });
});

describe("diffBrandKit — section properties (sourceLanguage)", () => {
  const GLOSSARY = "Glossary and Localization";

  it("emits a create change when the recipe sets a sourceLanguage and the kit is absent", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sectionProperties: { [GLOSSARY]: { sourceLanguage: "en-US" } } }),
      null
    );
    const change = plan.changes.find((c) => c.meta?.stage === "sectionProperty");
    expect(change).toMatchObject({
      kind: "create",
      path: `sectionProperties.${GLOSSARY}.sourceLanguage`,
      after: "en-US",
      meta: { stage: "sectionProperty", section: GLOSSARY, sourceLanguage: "en-US" },
    });
  });

  it("emits a create change when the live section has no sourceLanguage yet", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sectionProperties: { [GLOSSARY]: { sourceLanguage: "en-US" } } }),
      recipe({ name: "Acme" })
    );
    const change = plan.changes.find((c) => c.meta?.stage === "sectionProperty");
    expect(change?.kind).toBe("create");
    expect(change?.meta).toMatchObject({ section: GLOSSARY, sourceLanguage: "en-US" });
  });

  it("emits an update change when the sourceLanguage drifts", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sectionProperties: { [GLOSSARY]: { sourceLanguage: "fr-FR" } } }),
      recipe({ name: "Acme", sectionProperties: { [GLOSSARY]: { sourceLanguage: "en-US" } } })
    );
    const change = plan.changes.find((c) => c.meta?.stage === "sectionProperty");
    expect(change).toMatchObject({ kind: "update", before: "en-US", after: "fr-FR" });
  });

  it("emits no change when the sourceLanguage is unchanged (idempotent)", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme", sectionProperties: { [GLOSSARY]: { sourceLanguage: "en-US" } } }),
      recipe({ name: "Acme", sectionProperties: { [GLOSSARY]: { sourceLanguage: "en-US" } } })
    );
    expect(plan.changes.some((c) => c.meta?.stage === "sectionProperty")).toBe(false);
  });

  it("leaves the live sourceLanguage unmanaged when the recipe omits it", () => {
    const plan = diffBrandKit(
      recipe({ name: "Acme" }),
      recipe({ name: "Acme", sectionProperties: { [GLOSSARY]: { sourceLanguage: "en-US" } } })
    );
    expect(plan.changes.some((c) => c.meta?.stage === "sectionProperty")).toBe(false);
  });
});
