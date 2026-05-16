import { describe, expect, it } from "vitest";

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

const fakeContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "tok",
};

describe("scai://help/brand-kit-generation resource", () => {
  it("registers with markdown mimeType and an agent-facing description", async () => {
    const reg = await setup();
    const r = reg.listResources().find((x) => x.uri === "scai://help/brand-kit-generation")!;
    expect(r.mimeType).toBe("text/markdown");
    expect(r.name).toMatch(/brand kit/i);
    expect(r.description.length).toBeGreaterThan(50);
  });

  it("body covers both seed (path A) and direct-PATCH (path B) flows", async () => {
    const reg = await setup();
    const r = reg.listResources().find((x) => x.uri === "scai://help/brand-kit-generation")!;
    const result = await r.handler(fakeContext);
    const text = (result.contents[0] as { text: string }).text;
    // Both paths are named and walked.
    expect(text).toMatch(/Path A/);
    expect(text).toMatch(/Path B/);
    expect(text).toMatch(/Research/i);
    expect(text).toMatch(/Seed|seed flow/i);
    expect(text).toMatch(/PATCH|update-field/);
    // The synthesized-PDF failure is documented — agents need to
    // know not to waste paid pipeline runs on Chrome/WeasyPrint PDFs.
    expect(text).toMatch(/Chrome|Skia|WeasyPrint/);
    // Default section names — agents still need this set verbatim.
    for (const section of [
      "Brand Context",
      "Global Goals",
      "Tone of Voice",
      "Do's and Don'ts",
      "Grammar Checklists",
      "Visual Guidelines",
      "Image Style",
      "Glossary and Localization",
      "Checklist",
    ]) {
      expect(text).toContain(section);
    }
    // Cross-link to the file-formats resource.
    expect(text).toContain("scai://help/brand-file-formats");
  });
});

describe("scai://help/brand-file-formats resource", () => {
  it("registers with markdown mimeType + names the upload paths", async () => {
    const reg = await setup();
    const r = reg.listResources().find((x) => x.uri === "scai://help/brand-file-formats")!;
    expect(r.mimeType).toBe("text/markdown");
    expect(r.description).toMatch(/PDF|MIME|upload/i);
  });

  it("body documents URL-only upload and the MIME requirement", async () => {
    const reg = await setup();
    const r = reg.listResources().find((x) => x.uri === "scai://help/brand-file-formats")!;
    const result = await r.handler(fakeContext);
    const text = (result.contents[0] as { text: string }).text;
    // URL mode is the working path.
    expect(text).toMatch(/URL mode/);
    // Local-file / base64 is called out as unsupported.
    expect(text).toMatch(/[Bb]ase64/);
    expect(text).toMatch(/NOT SUPPORTED/);
    // MIME guidance — both correct and wrong forms.
    expect(text).toContain("application/pdf");
    expect(text).toMatch(/❌.*PDF/); // wrong-label callout
    // The two dead routes are named with why they fail.
    expect(text).toMatch(/multipart/);
    expect(text).toMatch(/server.broken/i);
    // The empirical sanity-check URL is named explicitly.
    expect(text).toContain("NMDOT");
    // Cross-link.
    expect(text).toContain("scai://help/brand-kit-generation");
  });
});
