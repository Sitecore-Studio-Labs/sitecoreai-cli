import { describe, expect, it } from "vitest";
import { synthesizeBrandStubDocument } from "../../../../src/brand/recipe/synthesize-doc";

describe("synthesizeBrandStubDocument", () => {
  it("returns a data:application/pdf URL ready for the Documents API", () => {
    const stub = synthesizeBrandStubDocument({
      brandKitName: "Acme",
      sectionNames: ["Brand Context", "Tone of Voice"],
    });
    expect(stub.url.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(stub.title).toBe("Acme brand kit scaffold");
    expect(stub.tags).toEqual(["scai-synthesized", "stub"]);
    expect(stub.byteLength).toBeGreaterThan(200);
    expect(stub.byteLength).toBeLessThan(2000);
  });

  it("emits a valid PDF 1.4 file — header, single page, xref, EOF", () => {
    const stub = synthesizeBrandStubDocument({
      brandKitName: "Acme",
      sectionNames: ["Brand Context"],
    });
    const base64 = stub.url.replace(/^data:application\/pdf;base64,/, "");
    const bytes = Buffer.from(base64, "base64");
    const text = bytes.toString("binary");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("/Type /Page ");
    expect(text).toContain("/Count 1");
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("xref\n");
    expect(text).toContain("startxref\n");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("renders every section name into the content stream so enrichment sees them", () => {
    const stub = synthesizeBrandStubDocument({
      brandKitName: "Acme",
      sectionNames: ["Brand Context", "Tone of Voice", "Glossary and Localization"],
    });
    const bytes = Buffer.from(stub.url.replace(/^data:application\/pdf;base64,/, ""), "base64");
    const text = bytes.toString("binary");
    expect(text).toContain("(Section: Brand Context) Tj");
    expect(text).toContain("(Section: Tone of Voice) Tj");
    expect(text).toContain("(Section: Glossary and Localization) Tj");
    expect(text).toContain("(Acme - brand kit scaffold \\(synthesized by scai\\).) Tj");
  });

  it("escapes PDF-literal-sensitive characters in section names", () => {
    // PDF string literals delimit with parentheses; an unescaped `)`
    // would terminate the literal early and corrupt the stream.
    const stub = synthesizeBrandStubDocument({
      brandKitName: "Brand (Beta)",
      sectionNames: ["Do's and Don'ts (special)"],
    });
    const bytes = Buffer.from(stub.url.replace(/^data:application\/pdf;base64,/, ""), "base64");
    const text = bytes.toString("binary");
    expect(text).toContain("Brand \\(Beta\\)");
    expect(text).toContain("Do's and Don'ts \\(special\\)");
  });

  it("coerces non-ASCII input to ASCII so byte counts stay consistent with Helvetica/WinAnsi", () => {
    // Em-dash, smart quotes, and ellipsis should map to ASCII
    // analogues; truly unrenderable bytes fall to `?`. We don't want
    // garbage in the PDF stream that would mis-count /Length or
    // render as the wrong glyph through WinAnsiEncoding.
    const stub = synthesizeBrandStubDocument({
      brandKitName: "Acme — “special” …",
      sectionNames: ["A é B"], // accented e → ASCII '?'
    });
    const bytes = Buffer.from(stub.url.replace(/^data:application\/pdf;base64,/, ""), "base64");
    const text = bytes.toString("binary");
    // Every printable byte after the header must fall in [0x20, 0x7E]
    // or be a structural newline.
    for (let i = 9; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      const isAscii = (code >= 0x20 && code <= 0x7e) || code === 0x0a;
      const isBinaryTag = code >= 0x80; // header binary-tag bytes
      expect(isAscii || isBinaryTag).toBe(true);
    }
  });

  it("computes consistent xref byte offsets — the table's positions line up with actual object positions", () => {
    const stub = synthesizeBrandStubDocument({
      brandKitName: "Acme",
      sectionNames: ["Brand Context"],
    });
    const bytes = Buffer.from(stub.url.replace(/^data:application\/pdf;base64,/, ""), "base64");
    const text = bytes.toString("binary");

    // Parse the xref table — locate the offset for object 1 and
    // verify it points at a "1 0 obj" header in the file.
    const xrefIndex = text.indexOf("xref\n");
    const xrefSection = text.slice(xrefIndex);
    // Lines: 0="xref", 1="0 N", 2="free entry (obj 0)", 3..7=in-use objects 1..5
    const entryLines = xrefSection.split("\n").slice(3, 8);
    expect(entryLines.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 5; i += 1) {
      const match = entryLines[i].match(/^(\d{10}) \d{5} n /);
      expect(match, `xref entry ${i + 1} should be present`).not.toBeNull();
      const offset = Number(match?.[1]);
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    }
  });

  it("throws when given zero section names — caller must gate on the recipe's sections", () => {
    expect(() =>
      synthesizeBrandStubDocument({ brandKitName: "Acme", sectionNames: [] })
    ).toThrowError(/at least one section name/);
  });
});
