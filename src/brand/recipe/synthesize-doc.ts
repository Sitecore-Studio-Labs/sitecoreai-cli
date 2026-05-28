/**
 * Synthesize a minimal stub PDF to drive the Sitecore EnrichSections
 * pipeline when a brand-kit recipe declares section content but ships
 * no source document.
 *
 * Why this exists: the Sitecore Brand Management API has no "create
 * section" endpoint — sections only appear as a side effect of
 * `EnrichSectionsPipeline` running over an uploaded document. A
 * recipe that wants to push field values into the canonical 7
 * sections (Global Goals, Brand Context, Tone of Voice, Do's and
 * Don'ts, Visual Guidelines, Grammar Checklists, Glossary and
 * Localization) must therefore feed the pipeline *something*. When
 * the operator has no real brand-guidelines PDF to upload, we
 * synthesize one: a single-page PDF naming each declared section so
 * enrichment produces the matching section structure. The actual
 * field values converge via `updateBrandKitField` PATCH calls
 * immediately after — the stub's content is throwaway scaffolding.
 *
 * The PDF is hand-rolled (no `pdf-lib` dependency). The format we
 * emit is a minimal, valid PDF 1.4 document with:
 *   - one Catalog → Pages → Page → Contents chain
 *   - one Helvetica font (built-in, no embedded data)
 *   - a single text stream with section names line-broken
 *
 * Sitecore's Documents API accepts `data:application/pdf;base64,…`
 * URLs in the v2 form-urlencoded create-request flow (verified in
 * [[project-scai-documents-api-v1-vs-v2]]), with a ~1MB limit from
 * the form-urlencoded body cap. Our synthesized PDF is well under
 * 1KB even for kits with the full canonical section list.
 */

/**
 * Reduce arbitrary input text to printable ASCII for safe embedding
 * in a PDF content stream that uses Helvetica + WinAnsiEncoding.
 *
 * Non-ASCII bytes would either (a) get truncated by
 * `Buffer.from(..., "binary")` to garbage codepoints, or (b) render
 * as the wrong glyph through the font's encoding map. Since this PDF
 * is throwaway scaffolding the Sitecore pipeline parses for section
 * names — not something a human reads — a lossy ASCII coercion is
 * the right tradeoff. Operators who care about display content
 * should ship a real document instead.
 */
const toPrintableAscii = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[‐-―]/g, "-") // dashes
    .replace(/[‘’‚‛]/g, "'") // single quotes
    .replace(/[“”„‟]/g, '"') // double quotes
    .replace(/…/g, "...") // ellipsis
    .replace(/[^\x20-\x7E]/g, "?");

/**
 * Escape a string for inclusion inside a PDF string literal — the
 * `(...)` form. Per PDF 1.4 §3.2.3, the backslash escape applies to
 * `(`, `)`, and `\`. Newlines are emitted as actual newlines in the
 * stream via separate Td positioning, so they never appear inside
 * a literal here. Caller is responsible for ASCII-sanitizing the
 * input first (see `toPrintableAscii`).
 */
const escapePdfLiteral = (input: string): string =>
  input.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/**
 * Build a single-page PDF whose content stream lists the given lines,
 * one line per row in 12pt Helvetica. Returns the raw bytes.
 *
 * Byte-offset bookkeeping: PDF's `xref` table demands the exact byte
 * offset of each object's first byte from the start of the file. We
 * concatenate object bodies into a running buffer and record each
 * object's position before appending it; the final `startxref` value
 * is the position of the `xref` keyword itself.
 */
const buildMinimalPdf = (lines: readonly string[]): Buffer => {
  // PDF 1.4 binary-tag comment — the four high-bit bytes mark the
  // file as binary so naive ASCII-only tools don't truncate it.
  const header = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";

  // Content stream — BT/ET wraps the text-rendering block; Td moves
  // the text cursor. 72,720 is roughly 1in from top-left on letter.
  const streamLines: string[] = ["BT", "/F1 12 Tf", "72 720 Td"];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) streamLines.push("0 -16 Td");
    streamLines.push(`(${escapePdfLiteral(lines[i] ?? "")}) Tj`);
  }
  streamLines.push("ET");
  const stream = streamLines.join("\n");

  // 5 indirect objects: Catalog, Pages, Page, Contents (text stream),
  // Font. Order matters — refs (e.g. /Pages 2 0 R) point at the
  // numbered indirect object below.
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  let body = header;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(body, "binary"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(body, "binary");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` + `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body + xref, "binary");
};

export interface SynthesizedStubDocument {
  /** Data URL (`data:application/pdf;base64,…`) ready for `BrandDocument.url`. */
  url: string;
  /** Display title used when uploading. */
  title: string;
  /** Tags applied to the synthesized document. Distinguishes it from
   *  operator-supplied docs for downstream filtering. */
  tags: string[];
  /** Byte length of the underlying PDF — useful for tests / logging. */
  byteLength: number;
}

export interface SynthesizeStubDocumentOptions {
  /** Brand-kit display name; used in the doc title + PDF body. */
  brandKitName: string;
  /** Section names declared in the recipe — one PDF line per name. */
  sectionNames: readonly string[];
}

/**
 * Build a stub brand-document for a recipe that has section data but
 * no source PDF. The synthesized doc has just enough structure for
 * Sitecore's BrandIngestion + EnrichSections pipelines to produce
 * the canonical section set; the field values declared in the recipe
 * overwrite enrichment's output via `updateBrandKitField`.
 *
 * Throws when `sectionNames` is empty — a stub doc with no section
 * names defeats the purpose, and callers should have gated on
 * "recipe has sections" before reaching here.
 */
export const synthesizeBrandStubDocument = (
  options: SynthesizeStubDocumentOptions
): SynthesizedStubDocument => {
  if (options.sectionNames.length === 0) {
    throw new Error(
      "synthesizeBrandStubDocument requires at least one section name; " +
        "callers should check `Object.keys(recipe.sections).length > 0` first."
    );
  }

  const headline = toPrintableAscii(
    `${options.brandKitName} - brand kit scaffold (synthesized by scai).`
  );
  const sectionLines = options.sectionNames.map((name) => toPrintableAscii(`Section: ${name}`));
  const lines: string[] = [headline, "", ...sectionLines];

  const pdf = buildMinimalPdf(lines);
  const base64 = pdf.toString("base64");

  return {
    url: `data:application/pdf;base64,${base64}`,
    title: `${options.brandKitName} brand kit scaffold`,
    tags: ["scai-synthesized", "stub"],
    byteLength: pdf.byteLength,
  };
};
