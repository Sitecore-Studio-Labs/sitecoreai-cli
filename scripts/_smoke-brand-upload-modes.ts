/**
 * Document-upload transport probe.
 *
 * Settles the open question behind the failed Allstate PDF: which
 * upload mode actually produces a document the server can fetch and
 * parse? The prior agent's note claims v2 multipart is "server-broken"
 * and that a `data:` URL works for local bytes — but the failed
 * Allstate doc (numberOfPages: 0, status: failed, url: data:...) shows
 * the data: URL path does NOT work.
 *
 * Tests four upload variants against a throwaway kit on the given env,
 * using the automation-client AI Skills token (the same token scai
 * uses). For each upload it polls the doc for ~60s watching for
 * numberOfPages > 0 — the signal that the server actually fetched and
 * read the file.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brand-upload-modes.ts agents
 *
 * Leaves a throwaway kit on the tenant — delete via the Stream UI or
 * `scai brand kits delete` afterwards.
 */
import { readRootConfiguration } from "@/config/root-config";
import { acquireAiSkillsToken } from "@/brand/api/auth";
import { AI_SKILLS_API_HOST } from "@/brand/api/types";

const DOCS_PATH = "/stream/ai-document-api";
const BRANDS_PATH = "/stream/ai-brands-api";

/** Build a minimal but valid 2-page PDF with a correct xref table. */
const buildTestPdf = (): Buffer => {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
    "<< /Length 48 >>\nstream\nBT /F1 24 Tf 72 700 Td (scai probe p1) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 48 >>\nstream\nBT /F1 24 Tf 72 700 Td (scai probe p2) Tj ET\nendstream",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
};

type Variant = {
  name: string;
  description: string;
  build: (
    pdf: Buffer,
    createRequest: string
  ) => { body: FormData | string; headers: Record<string, string> };
};

const variants: Variant[] = [
  {
    name: "multipart-cr-first",
    description: "multipart/form-data, create_request part BEFORE file part",
    build: (pdf, cr) => {
      const fd = new FormData();
      fd.append("create_request", cr);
      fd.append("file", new Blob([pdf], { type: "application/pdf" }), "scai-probe.pdf");
      return { body: fd, headers: {} };
    },
  },
  {
    name: "multipart-file-first",
    description: "multipart/form-data, file part BEFORE create_request part",
    build: (pdf, cr) => {
      const fd = new FormData();
      fd.append("file", new Blob([pdf], { type: "application/pdf" }), "scai-probe.pdf");
      fd.append("create_request", cr);
      return { body: fd, headers: {} };
    },
  },
  {
    name: "multipart-cr-plain-blob",
    description: "multipart/form-data, create_request as text/plain Blob, then file",
    build: (pdf, cr) => {
      const fd = new FormData();
      fd.append("create_request", new Blob([cr], { type: "text/plain" }));
      fd.append("file", new Blob([pdf], { type: "application/pdf" }), "scai-probe.pdf");
      return { body: fd, headers: {} };
    },
  },
  {
    name: "urlencoded-data-url",
    description: "form-urlencoded, file as data: URL in create_request (current scai bytes mode)",
    build: (pdf, _cr) => {
      const dataUrl = `data:application/pdf;base64,${pdf.toString("base64")}`;
      const cr = JSON.stringify({ ...JSON.parse(_cr), url: dataUrl });
      const params = new URLSearchParams();
      params.set("create_request", cr);
      return {
        body: params.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      };
    },
  },
];

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "agents";
  const root = readRootConfiguration(process.cwd(), envName);
  const env = root.environments[envName];
  const orgId = env?.organizationId;
  if (!orgId) {
    process.stderr.write(`ERROR: env '${envName}' has no organizationId.\n`);
    process.exit(2);
  }
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    process.stderr.write(`ERROR: no AI Skills credential for org '${orgId}'.\n`);
    process.exit(3);
  }

  const host = AI_SKILLS_API_HOST;
  const token = await acquireAiSkillsToken({ orgId, credential });
  process.stderr.write(`> env=${envName} org=${orgId} host=${host}\n`);
  process.stderr.write(`> token len=${token.length}\n\n`);

  // Create a throwaway kit to attach probe docs to.
  const kitName = `scai-upload-probe-${Date.now()}`;
  const kitRes = await fetch(
    new URL(`${BRANDS_PATH}/api/brands/v1/organizations/${orgId}/brandkits`, host).toString(),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ name: kitName, brandName: kitName, description: "upload-mode probe" }),
    }
  );
  const kit = (await kitRes.json()) as { id?: string };
  if (!kit.id) {
    process.stderr.write(`ERROR: kit create failed (${kitRes.status}).\n`);
    process.exit(7);
  }
  process.stderr.write(`> probe kit: ${kit.id} (${kitName})\n\n`);

  const pdf = buildTestPdf();
  process.stderr.write(`> test PDF: ${pdf.length} bytes, 2 pages\n\n`);

  const docsUrl = new URL(
    `${DOCS_PATH}/api/documents/v2/organizations/${orgId}/documents`,
    host
  ).toString();

  const results: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    process.stderr.write(`=== ${variant.name} ===\n  ${variant.description}\n`);
    const createRequest = JSON.stringify({
      url: "",
      setMetadata: true,
      type: "brand guidelines",
      fileType: "application/pdf",
      title: `probe ${variant.name}`,
      summary: "upload-mode probe doc",
      tags: [],
      references: [
        {
          type: "brandkit",
          id: kit.id,
          path: `/api/brands/v1/organizations/${orgId}/brandkits/${kit.id}/references`,
        },
      ],
    });

    const { body, headers } = variant.build(pdf, createRequest);
    let status = 0;
    let respText = "";
    let docId = "";
    try {
      const res = await fetch(docsUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers },
        body,
      });
      status = res.status;
      respText = await res.text();
      try {
        docId = (JSON.parse(respText) as { id?: string }).id ?? "";
      } catch {
        /* non-JSON response */
      }
    } catch (err) {
      respText = `fetch threw: ${String(err)}`;
    }

    process.stderr.write(`  POST -> ${status}${docId ? ` docId=${docId}` : ""}\n`);
    if (!docId) {
      process.stderr.write(`  body: ${respText.slice(0, 400)}\n\n`);
      results.push({
        variant: variant.name,
        status,
        uploaded: false,
        body: respText.slice(0, 400),
      });
      continue;
    }

    // Poll the doc for up to 60s, watching numberOfPages + status.
    let finalDoc: Record<string, unknown> = {};
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 8_000));
      const docRes = await fetch(`${docsUrl}/${docId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      finalDoc = (await docRes.json()) as Record<string, unknown>;
      const np = finalDoc.numberOfPages;
      const st = finalDoc.status;
      process.stderr.write(
        `  poll: status=${st} numberOfPages=${np} chunked=${finalDoc.chunked}\n`
      );
      if ((typeof np === "number" && np > 0) || st === "failed" || st === "processed") break;
    }
    process.stderr.write("\n");
    results.push({
      variant: variant.name,
      status,
      uploaded: true,
      docId,
      finalStatus: finalDoc.status,
      numberOfPages: finalDoc.numberOfPages,
      chunked: finalDoc.chunked,
      serverFetchedFile: typeof finalDoc.numberOfPages === "number" && finalDoc.numberOfPages > 0,
    });
  }

  process.stdout.write(`${JSON.stringify({ envName, kitId: kit.id, results }, null, 2)}\n`);
  process.stderr.write(`\n> probe kit ${kit.id} left on tenant — delete when done.\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
