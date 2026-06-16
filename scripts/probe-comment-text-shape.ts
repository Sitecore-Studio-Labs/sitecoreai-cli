/**
 * Probe what text shapes the Brief API's POST /comments accepts, and
 * crucially whether any shape lets the dedicated list endpoint
 * (`GET /comments?BriefId=...`) actually return 2xx — currently it's
 * 500ing on TestDemo across every MetadataToLoad variant, and we
 * suspect prior posts (text=bare string) are the cause.
 *
 * For each candidate text shape:
 *   1. POST a comment, capture the returned shape.
 *   2. GET the brief and check whether the inline comments[] now has
 *      populated fields (vs id-only entries).
 *   3. Hit the list endpoint and report status — does it 500 or 200?
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-comment-text-shape.ts <briefId> <authorAuth0Sub>
 */
import {
  createBrief,
  createBriefComment,
  deleteBrief,
  getBrief,
  resolveBriefClient,
} from "@/brief";
import type { BriefApiClientOptions } from "@/brief/api/types";

const probeMarker = (n: number) => `[probe-shape-${n}-${Date.now().toString(36)}]`;

const PM_DOC = (text: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text }],
    },
  ],
});

/** Liveblocks `CommentBody` shape — version 1, content is an array of
 *  block nodes (paragraph/mention/etc) where text leaves use `children`
 *  with `{text: "..."}` entries. Distinct from ProseMirror (PM uses
 *  `content` + `type:"text"` leaves). */
const LIVEBLOCKS_BODY = (text: string) => ({
  version: 1,
  content: [
    {
      type: "paragraph",
      children: [{ text }],
    },
  ],
});

interface Candidate {
  label: string;
  text: unknown;
}

const CANDIDATES = (n: number): Candidate[] => [
  // What scai currently sends (bare string) — our suspected culprit.
  { label: "bare-string", text: probeMarker(n) },
  // ProseMirror doc node (other RichText fields' expected shape).
  { label: "prosemirror-doc", text: PM_DOC(probeMarker(n)) },
  // Liveblocks CommentBody — user reports comments are backed by
  // Liveblocks, so this is the shape the read path may expect.
  { label: "liveblocks-body", text: LIVEBLOCKS_BODY(probeMarker(n)) },
  // Wrapped {type:"RichText", value:<liveblocks body>} just in case
  // the server wants both the envelope AND the LB body.
  {
    label: "wrapped {type:RichText, value:liveblocks-body}",
    text: { type: "RichText", value: LIVEBLOCKS_BODY(probeMarker(n)) },
  },
];

const tryListAfter = async (
  client: BriefApiClientOptions,
  briefId: string
): Promise<{ status: number; body: string }> => {
  const u = new URL(`${client.baseUrl}/api/brief/v1/comments`);
  u.searchParams.set("BriefId", briefId);
  const res = await fetch(u, {
    headers: {
      Authorization: `Bearer ${client.accessToken}`,
      Accept: "application/json",
    },
  });
  return { status: res.status, body: (await res.text()).slice(0, 400) };
};

async function main(): Promise<void> {
  const [briefTypeId, authorId] = process.argv.slice(2);
  if (!briefTypeId || !authorId) {
    console.error("Usage: probe-comment-text-shape.ts <briefTypeId> <authorAuth0Sub>");
    process.exit(2);
  }

  const { client } = await resolveBriefClient({});
  // Disposable brief so we don't pollute an existing brief's thread.
  const fresh = await createBrief(client, {
    name: `[probe-comment-shape ${new Date().toISOString()}]`,
    briefTypeId,
    locale: "en-us",
    fields: {},
    isTemplate: false,
  });
  const briefId = fresh.id;
  console.log(`Created disposable brief ${briefId}\n`);
  try {
    const listBefore = await tryListAfter(client, briefId);
    console.log(`Before any probe writes:`);
    console.log(`  list endpoint status: ${listBefore.status}`);
    console.log(`  body: ${listBefore.body}`);

    for (const [i, c] of CANDIDATES(0).entries()) {
      console.log(`\n=== ${i + 1}/${CANDIDATES(0).length}: ${c.label} ===`);
      try {
        const posted = await createBriefComment(client, {
          briefId,
          text: c.text as never,
          authorId,
        });
        console.log(`  POST returned: ${JSON.stringify(posted).slice(0, 600)}`);
      } catch (err) {
        console.log(
          `  POST FAILED: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`
        );
        continue;
      }

      // Re-read brief inline comments to confirm count.
      const brief = await getBrief(client, briefId);
      console.log(`  brief.comments.length now: ${brief.comments.length}`);

      // Try the list endpoint again.
      const list = await tryListAfter(client, briefId);
      console.log(`  list endpoint after this write: ${list.status}`);
      if (list.status !== 200) {
        console.log(`  body: ${list.body}`);
      } else {
        console.log(`  body sample: ${list.body}`);
      }
    }
  } finally {
    try {
      await deleteBrief(client, briefId);
      console.log(`\nDeleted disposable brief.`);
    } catch (err) {
      console.warn(`Cleanup delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
