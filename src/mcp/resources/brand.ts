/**
 * `scai://help/brand-*` resources — agent-discoverable guidance for the
 * brand area. Two markdown documents:
 *
 *   - `scai://help/brand-kit-generation` — marketing-shaped guide for
 *     agents told "create a brand kit for <real brand>". Walks the
 *     two ingestion paths (URL-mode seed vs. direct-PATCH), explains
 *     every default section, and gives a prompt skeleton for
 *     generating brand-guidelines source content.
 *
 *   - `scai://help/brand-file-formats` — reference for the file format
 *     quirks the brand area surfaces. Explains why only URL upload
 *     works, the "I have a local PDF" path (host it first), and what
 *     makes a PDF parseable.
 *
 * Both are deliberately tight — agents pull these into context to make
 * one decision (which path to use), not to read a textbook.
 */

import type { McpRegistry } from "../registry";

const BRAND_KIT_GENERATION_TEXT = `# Brand kit generation — agent loop

scai's brand area lets you create Sitecore AI brand kits from source
material, then evaluate marketing copy against them. This resource is
for agents asked to **create a brand kit for a real brand** (Spotify,
Apple, Mailchimp, …).

## Two paths — pick by whether you have a hostable PDF

The root constraint is **how a document reaches Sitecore**, not what
the PDF looks like. Document upload has exactly one working transport:

- **URL mode works.** Sitecore fetches the PDF server-side from an
  HTTPS URL its edge can reach, copies it to MMS, and processes it.
- **base64 / \`data:\` URL upload does NOT work.** The POST is accepted
  (201) but the server never decodes the inline bytes — the doc sticks
  at \`pages: 0\`, reaches \`chunked: true\` on nothing, never reaches
  \`summarized\`, and transitions to \`failed\` after ~6 min. Verified
  2026-05-15 against **both** a synthesized PDF (headless Chrome,
  WeasyPrint) **and a real InDesign-class PDF** (an 8-page slice of a
  genuine published report). All three failed identically — so the
  failure is the base64 transport, not the PDF's structure or origin.

Practical consequence: a PDF you can't host at a URL cannot be
ingested at all. That gives you two routes:

### Path A — hostable brand-guide PDF (seed flow, AI-extracted)

Use this when you have a PDF that is *already* at a public HTTPS URL,
or that you can host at one (S3, GitHub raw, a CDN). The brand's own
published guidelines PDF is ideal (look for \`/press\`, \`/brand\`,
\`<university>.edu/brand\`, etc.) — the seed pipeline does the heavy
lifting and the AI summary is high-quality when reading real brand
authoring. Content shape still matters: the pipeline summarizes
best from PDFs structured like brand guidelines (see "Source PDF
structure that works" below).

1. **Research** the brand's voice, audience, and identity from public
   sources.
2. **Get the PDF to an HTTPS URL** — either find one the brand already
   publishes, or host your own copy. A purely local PDF cannot be
   ingested; there is no working local-file upload.
3. **Seed** via \`brand_manage action=seed\` with the PDF URL. Takes
   5–15 min.
4. **Verify** with \`brand_inspect verb=list-sections\` and
   \`verb=list-fields\`. Confirm field \`value\`s are populated.

### Path B — no hostable PDF (direct-PATCH flow, recommended for AI-generated kits)

Use this when you (the agent) are *authoring* the brand guide from
research, or when you have a PDF you can't host at a URL. Don't try to
synthesize a PDF and upload it — base64 upload doesn't work, and a
locally-rendered PDF has nowhere to be fetched from. Go straight to
direct field PATCH.

1. **Research** the brand from public sources, as in path A.
2. **Create an empty kit** via \`brand_manage action=create-kit\`.
3. **Publish it** via \`brand_manage action=publish-kit\` — required
   before sections appear.
4. **Trigger structure** via \`brand_manage action=run-enrichment\` to
   make the 9 default sections + ~27 default fields appear. (Or
   inspect after publish — they often appear without a pipeline run.)
5. **List fields** per section with \`brand_inspect verb=list-fields\`
   to grab each \`sectionId\` + \`fieldId\` + \`type\` + \`intent\`.
6. **PATCH each field** with \`brand_manage action=update-field\`,
   passing a \`value\` whose shape matches the field's \`type\`:
   - \`type=text\` → \`value: "single paragraph string"\`
   - \`type=array\` → \`value: [{ name: "first bullet" }, …]\`
   - \`type=richArray\` → \`value: [{ name, tags: [...], restrictions }, …]\`
   Set \`verified: true\` so the field shows as operator-curated.
7. **Verify** with \`brand_inspect verb=list-fields\` and try a
   \`brand_review\`. Heads-up: \`brand_review\` may still error if the
   kit has no successfully-ingested document attached (the review
   endpoint uses doc chunks for RAG context). Direct-PATCH kits are
   readable and inspectable but may not be reviewable until a real
   brand-guide PDF is also attached.

## Default sections (always created)

Every brand kit ships with these predefined sections — they're populated
during ingestion if the source PDF discusses each topic:

| Section | What goes in it |
|---|---|
| **Brand Context** | Purpose, history, ambition, target consumer, benefits |
| **Global Goals** | Diversity, accessibility, SEO/digital, compliance |
| **Tone of Voice** | Voice traits (e.g. "warm but not casual"), do/don't examples |
| **Do's and Don'ts** | Explicit rules ("write 'cuts page load 40%' not 'lightning fast'") |
| **Grammar Checklists** | Style preferences (active voice, sentence length) |
| **Visual Guidelines** | Logo, color palette, packaging notes |
| **Image Style** | Photography style, illustration treatment |
| **Glossary and Localization** | Approved terminology, non-translatable terms |
| **Checklist** | Framework / approval checklist for new content |

## Source PDF structure that works

Sitecore's AI extracts content from PDFs that look like real brand
guidelines. Stitching arbitrary text into a PDF rarely produces useful
sections — verified empirically with random PDFs (encyclopedia chapters,
unrelated government docs) failing summarization.

A working source PDF looks like:

\`\`\`
# <Brand> Brand Guidelines

## Brand Context
**Purpose:** <one paragraph>
**History:** <one paragraph>
**Ambition:** <one paragraph>
**Consumer:** <who we speak to>

## Tone of Voice
We are <trait 1>, <trait 2>, <trait 3>.
- Do: <concrete examples>
- Don't: <concrete anti-examples>

## Do's and Don'ts
1. Do <rule>. Don't <opposite>.
2. ...

## Visual Guidelines
**Color:** <hex codes + meaning>
**Logo:** <clear-space rules, minimum size>
...
\`\`\`

Aim for **3–8 pages, ≤500KB**. Larger PDFs (3MB+) work via URL mode but
sometimes hit Sitecore's parser; smaller is more reliable.

## Researching a real brand

Sources that consistently produce extractable content:

- **<brand>.com/press** or /brand-guidelines pages (some publish PDFs)
- **<brand>.design** (Spotify, Mailchimp, GitLab do this)
- The brand's app/website microcopy (read 20 pages, infer the tone)
- Recent ads or campaigns (capture the voice)
- Press releases (formal tone)

What to write down per section:

- **Brand Context**: 2–4 sentences each on purpose, history, ambition,
  target consumer.
- **Tone of Voice**: 3–5 trait words ("warm, direct, expert") + 2 do/don't
  pairs.
- **Dos and Don'ts**: 5–8 concrete rules. Specifics over abstractions:
  "use action verbs in headlines" beats "be active."
- **Visual Guidelines**: color palette (3–5 hex codes), logo notes,
  layout principles.
- **Glossary**: 5–10 brand-specific terms + which ones don't translate.

## Generating the source PDF (path A only)

scai does NOT generate PDFs — you (the agent) bring the file. Upload
is **URL-only** — Sitecore fetches the PDF server-side, so it must
live at an HTTPS URL the Sitecore edge can reach. For **path A** (real
brand-guide PDF), two sub-options:

1. **Use an existing brand guide URL** — fastest. Many brands publish
   guidelines as PDFs at predictable URLs:
   - https://www.dot.nm.gov/wp-content/uploads/2024/04/NMDOT-Public-Engagement-Brand-Guide_2024.pdf (proven to ingest cleanly)
   - University brand sites (search "<university> brand guidelines filetype:pdf")
2. **Host a local brand guide yourself** — fetch or copy the PDF to a
   public URL (S3, GitHub raw, a CDN), then pass via \`url\`. There is
   no local-file / base64 upload path; see brand-file-formats.

**Do NOT attempt to synthesize a brand-guide PDF and feed it to seed
as local bytes.** The blocker is the upload transport, not the PDF: a
synthesized PDF has nowhere to be fetched from, and base64 / \`data:\`
URL upload is non-functional (POST accepted, bytes never decoded —
doc stalls at \`pages: 0\` and \`failed\`). This was checked thoroughly
on 2026-05-15: headless Chrome (\`Skia/PDF\`), WeasyPrint, a
\`qpdf --linearize\`'d variant, **and an 8-page slice of a genuine
InDesign-class published PDF** were all uploaded via base64 — every
one failed identically (\`chunked: true\` → never \`summarized\` →
\`pages: 0\` → \`failed\`). The real PDF failing the same way as the
synthetic ones rules out "PDF structure" as the cause. If you can host
the synthesized PDF at a URL it *may* ingest (content shape still
matters), but for AI-generated kits **path B (direct PATCH)** is
simpler and avoids paid pipeline runs entirely.

## Path A — seed flow (real brand-guide PDF)

\`\`\`
# 1. Find or fetch a real brand-guide PDF (out of scope for scai)
# 2. Seed (takes 5–15 min, paid AI compute)
brand_manage {
  action: "seed",
  name: "Spotify",
  url: "https://your-cdn.example/spotify-guidelines.pdf",
  industry: "music",
  description: "Generated brand kit for Spotify",
  allowWrite: true
}
# → returns kit.id, sections[], elapsedSec
#   emits MCP progress events at each stage

# 3. Verify the kit ingested correctly
brand_inspect { verb: "list-sections", brandKitId: <id> }
# → 9 sections expected

# 4. Inspect what the AI extracted into each section
brand_inspect { verb: "list-fields", brandKitId: <id>, sectionId: <sec> }
# → fields with intent (what the AI looks for) + value (what it found)

# 5. Try a Brand Review
brand_review { brandKitId: <id>, text: "<test copy>", label: "test.md" }
\`\`\`

## Path B — direct PATCH (synthesized / AI-generated kit)

\`\`\`
# 1. Create the kit (no PDF needed)
brand_manage { action: "create-kit", name: "Allstate", industry: "Insurance",
               description: "…", allowWrite: true }
# → returns kit.id

# 2. Publish so sections appear
brand_manage { action: "publish-kit", brandKitId: <id>, allowWrite: true }

# 3. (Optional but reliable) trigger structure
brand_manage { action: "run-enrichment", brandKitId: <id>, allowWrite: true }

# 4. List all sections, then per section list all fields. Capture
#    each field's { id, type, intent } — the type drives the value
#    shape you must write back.
brand_inspect { verb: "list-sections", brandKitId: <id> }
brand_inspect { verb: "list-fields", brandKitId: <id>, sectionId: <sec> }

# 5. PATCH each field — once per field. Set verified=true to mark
#    operator-curated content.
brand_manage {
  action: "update-field",
  brandKitId: <id>,
  sectionId: <sec>,
  fieldId: <field>,
  value: "<string for text, [{name}] for array, [{name,tags,restrictions}] for richArray>",
  verified: true,
  allowWrite: true
}
\`\`\`

A real Allstate kit was populated this way in 27 PATCHes (2026-05-15),
across all 9 default sections, after base64 PDF upload was confirmed
non-functional.

## Failure modes + how to recover

- **\`scai brand kits sections <id>\` shows 0 sections after 15 min**:
  Pipeline failed. If you uploaded by URL with brand-shaped content,
  re-seed with a better-structured source PDF; if you tried base64,
  that's the cause — base64 upload doesn't work (see below).
- **\`document.status: "failed"\` during seed**: NOT a real error.
  Sections still populate via the enrichment pipeline. Ignore and keep
  polling.
- **\`document.status: "failed"\` AND field values stay empty after
  15 min**: real failure. The most common cause is base64 / \`data:\`
  URL upload, which is non-functional — the doc reaches \`chunked: true\`
  on nothing, \`pages\` stays 0, and it never \`summarized\`. This was
  verified identical for synthesized PDFs AND a real InDesign-class
  PDF, so it is NOT a PDF-structure problem. Either host the PDF at a
  URL and re-seed, or switch to **path B** (direct PATCH).
- **\`brand_review\` returns 500 'name' or 200 with empty body**: kit
  has no sections OR no successfully-ingested document. For an
  AI-generated kit populated via path B, attaching a real brand-guide
  PDF (path A flow) afterwards can unlock review; the document chunks
  feed the review endpoint's RAG context.
- **Auth0 403 "insufficient scope"**: AI APIs key lacks
  \`ai.org.br:gen\`. Recreate the credential in Cloud Portal → Stream →
  Admin → AI APIs keys.
- **PATCH returns 422 on \`update-field\`**: \`value\` shape doesn't
  match the field's \`type\`. Run \`brand_inspect verb=list-fields\` to
  confirm whether the field is \`text\` (string), \`array\` (\`[{name}]\`),
  or \`richArray\` (\`[{name, tags, restrictions}]\`).

## Costs

Each seed runs **two paid AI pipelines** (ingestion + enrichment) and
each brand_review is one paid inference call. Don't loop without
explicit budget — there's no rate-limit visibility in the API.

## Related resources

- \`scai://help/brand-file-formats\` — exact recipes for URL/bytes/MIME
  with the server quirks called out.
- \`scai://help/overview\` — scai MCP basics.
`;

const BRAND_FILE_FORMATS_TEXT = `# Brand area file formats — what works, what breaks

The Sitecore Brand Documents API has documented file-format
constraints AND empirically-discovered quirks. This reference is what
scai's brand tools learned to navigate.

## Accepted file types

**PDF only.** The endpoint advertises support for other types via its
\`fileType\` field, but ingestion only succeeds for PDFs. Markdown, plain
text, JSON, and images either reject at upload or fail during the
summarization pipeline.

## MIME type field — must be exact

The \`fileType\` field on the upload accepts MIME types. Use the
**exact MIME**, not the label:

- ✅ \`application/pdf\`
- ❌ \`"PDF"\`
- ❌ \`"pdf"\`
- ❌ \`"text/pdf"\` (not a real MIME)

A wrong \`fileType\` causes \`numberOfPages\` to stay 0, \`tags\` to stay
empty, and the doc to never reach \`processed\`. scai's \`uploadDocument\`
defaults to \`application/pdf\` correctly.

## Upload is URL-only

### URL mode — the only working path

Host the PDF somewhere Sitecore's edge can reach (S3, GitHub raw, public
CDN), pass the URL:

\`\`\`
brand_manage {
  action: "upload-doc",
  brandKitId: <kit>,
  url: "https://your-cdn/brand-guidelines.pdf",
  title: "Guidelines",
  allowWrite: true
}
\`\`\`

Sitecore re-fetches the file and copies it to its own MMS (Managed
Media Service). The request body is tiny (just the URL string), so
**file size doesn't matter** — 50MB PDFs are fine if the URL works.

The response shows the MMS URL, not your original URL:
\`url: "https://mms-delivery.sitecorecloud.io/api/media/v1/delivery/protected/<hash>"\`

### Local files / base64 — NOT SUPPORTED

There is no working path to upload a local file to the documents API.
\`bytesBase64\` is rejected with \`INPUT_INVALID\`. Both routes the API
nominally offers are dead (verified 2026-05-15,
\`scripts/_smoke-brand-upload-modes.ts\`):

- **v2 multipart \`file\` part** — server-broken. Whenever a \`file\`
  part is present the parser drops the sibling \`create_request\` part
  and returns \`400 create_request: Field required\`. Reproduced across
  field order, per-part Content-Type, and boundary format.
- **\`data:\` URL in the \`url\` field** — accepted at POST time (201)
  but the server never decodes the inline bytes, so the doc stays at
  \`numberOfPages: 0\`, reaches \`chunked: true\` on nothing, never
  \`summarized\`, and ends \`failed\` after ~6 min. Confirmed identical
  for a synthesized PDF *and* a real InDesign-class PDF — so this is
  the transport failing, not the PDF.

If you have a local PDF: host it at an HTTPS URL first, then use URL
mode. To populate a kit without a PDF at all, use the direct-PATCH
field flow (\`action: "update-field"\`).

## PDF content requirements

The Sitecore Brand ingestion pipeline tries to extract
**brand-shaped knowledge** from the PDF — section names like Brand
Context, Tone of Voice, etc. PDFs that don't look like brand guidelines
fail the summarization step:

- ❌ Random encyclopedia chapter → \`status: failed\` after 5 min
- ❌ Government report → \`status: failed\`
- ❌ Hand-rolled 1-page PDF with random text → \`status: failed\`
- ✅ Actual brand guidelines PDF (3–8 pages, structured by section) →
  \`status: processed\`, sections populated

## base64 upload fails — for ANY PDF, real or synthesized

The earlier theory was that *synthesized* PDFs (Chrome, WeasyPrint)
failed because Sitecore's parser wanted InDesign-class structure.
**That theory is wrong.** Controlled testing on 2026-05-15 in a real
tenant — every PDF below uploaded via base64 / \`data:\` URL:

| PDF | Producer | Real authoring tool? | Result |
|---|---|---|---|
| Headless Chrome render | \`Skia/PDF m148\` | no | \`chunked: true\`, \`pages: 0\` → \`failed\` |
| WeasyPrint render | \`WeasyPrint 68.1\` | no | \`chunked: true\`, \`pages: 0\` → \`failed\` |
| \`qpdf --linearize\`'d Chrome render | Skia internals | no | same failure |
| 8-page slice of a genuine published report | InDesign-class, Linearized | **yes** | \`chunked: true\`, \`pages: 0\` → \`failed\` |

The real InDesign-class PDF failed **identically** to the synthesized
ones. That rules out PDF structure as the cause. The actual cause is
the **base64 / \`data:\` URL upload transport**: Sitecore accepts the
POST (201) but never decodes the inline bytes, so every doc — real or
synthetic — stalls at \`pages: 0\` and ends \`failed\`.

**What actually works:** URL mode. Sitecore fetches the PDF
server-side from an HTTPS URL. A real brand-guide PDF hosted at a URL
ingests cleanly (the NMDOT guide below is the proof point).

**Recommendation:**
- Have a PDF + can host it at a URL → URL mode (\`action: "seed"\` or
  \`upload-doc\` with \`url\`).
- Can't host it, or you're authoring the kit yourself → **path B
  (direct PATCH)** from \`scai://help/brand-kit-generation\`.
- Never spend paid pipeline runs on base64 upload — it cannot succeed.

If you're authoring a PDF for URL-mode ingestion, include explicit
section headers matching the default kit sections (see
\`scai://help/brand-kit-generation\`) — content shape still affects
summarization quality even though it's not what causes the base64
failure.

## What "failed" actually means

The document's \`status\` field reaches \`failed\` ~5 min after the
ingestion pipeline starts, **regardless of whether enrichment succeeds**.
The status reflects the ingestion stage, not the kit-level outcome.

- If sections DO populate within 15 min → success, ignore the
  \`status: failed\` flag.
- If sections DON'T populate within 15 min → real failure. Check the
  upload transport first: a base64 / \`data:\` URL upload never
  processes (see above), so that's the most common cause. If the doc
  was uploaded by URL, the next suspect is content shape — a PDF that
  doesn't read like brand guidelines summarizes poorly.

scai's \`seedBrandKit\` composite polls section count, not document
status, for exactly this reason.

## Sanity-check PDF that works

If you're debugging a tenant or scope issue and want to rule out PDF
content as the variable, use:

\`\`\`
https://www.dot.nm.gov/wp-content/uploads/2024/04/NMDOT-Public-Engagement-Brand-Guide_2024.pdf
\`\`\`

The NMDOT Public Engagement Brand Guide is a real, well-structured
brand guide that ingests + populates sections successfully (verified
2026-05-14). If THIS PDF fails on your tenant, the problem isn't your
content — it's the credential, the org's AI quota, or a Sitecore
incident.

## Have a local PDF? Host it, then use URL mode

\`\`\`
# Upload by URL (the only working path):
scai brand docs upload <kitId> --url https://your-cdn/brand-guidelines.pdf
scai brand seed --name "Spotify" --url https://your-cdn/brand-guidelines.pdf
\`\`\`

A local file path is rejected — host the PDF at a public HTTPS URL
(S3, GitHub raw, a CDN) Sitecore's edge can reach, then pass \`--url\`.

## Related resources

- \`scai://help/brand-kit-generation\` — agent loop for creating fake
  brand kits.
- \`scai://help/overview\` — scai MCP basics.
`;

export const registerBrandResources = (registry: McpRegistry): void => {
  registry.registerResource({
    uri: "scai://help/brand-kit-generation",
    name: "Brand kit generation guide",
    description:
      "Markdown guide for agents asked to create a brand kit for a real brand. Walks the research→author→seed→verify loop, lists every default section + what it captures, and provides a brand-guidelines source PDF skeleton. Pair with brand-file-formats for the upload mechanics.",
    mimeType: "text/markdown",
    handler: async () => ({
      contents: [
        {
          uri: "scai://help/brand-kit-generation",
          mimeType: "text/markdown",
          text: BRAND_KIT_GENERATION_TEXT,
        },
      ],
    }),
  });

  registry.registerResource({
    uri: "scai://help/brand-file-formats",
    name: "Brand area file formats reference",
    description:
      "Markdown reference for the file format constraints scai's brand tools navigate: MIME requirements (application/pdf, not 'PDF'), why upload is URL-only (local-file / base64 / multipart all dead), what makes a PDF parseable, and what 'status: failed' actually means.",
    mimeType: "text/markdown",
    handler: async () => ({
      contents: [
        {
          uri: "scai://help/brand-file-formats",
          mimeType: "text/markdown",
          text: BRAND_FILE_FORMATS_TEXT,
        },
      ],
    }),
  });
};
