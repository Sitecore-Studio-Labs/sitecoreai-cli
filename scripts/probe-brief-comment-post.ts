/**
 * Probe whether the Brief API's POST /comments endpoint actually
 * persists a comment that's then visible via GET. Verifies the round-
 * trip the orchestrator relies on for brief comments.
 *
 * Plan:
 *   1. POST a probe comment with an explicit authorId (Auth0 sub).
 *   2. GET the brief — does `comments[]` include the new entry?
 *   3. List /comments?BriefId=... — does the entry appear there?
 *   4. Report `createdBy` vs `author` so we know what the
 *      impersonation actually changed.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-brief-comment-post.ts <briefId> <authorAuth0Sub>
 */
import { createBriefComment, getBrief, listBriefComments, resolveBriefClient } from "@/brief";

async function main(): Promise<void> {
  const [briefId, authorId] = process.argv.slice(2);
  if (!briefId || !authorId) {
    console.error("Usage: probe-brief-comment-post.ts <briefId> <authorAuth0Sub>");
    process.exit(2);
  }

  const { client } = await resolveBriefClient({});
  const before = await getBrief(client, briefId);
  console.log(`Before: brief.comments.length = ${before.comments.length}`);

  const text = `[probe-comment ${new Date().toISOString()}]`;
  console.log(`POST /comments with authorId=${authorId} text=${text}`);
  let posted: unknown;
  try {
    posted = await createBriefComment(client, {
      briefId,
      text,
      authorId,
    });
    console.log(`POST returned: ${JSON.stringify(posted).slice(0, 500)}`);
  } catch (err) {
    console.error(`POST failed: ${err instanceof Error ? err.message.slice(0, 400) : String(err)}`);
    process.exit(1);
  }

  // Re-read brief.
  const afterBrief = await getBrief(client, briefId);
  console.log(`\nAfter: brief.comments.length = ${afterBrief.comments.length}`);
  for (const c of afterBrief.comments) {
    if (String(JSON.stringify(c)).includes("probe-comment")) {
      console.log(`Found probe in brief.comments:`);
      console.log(JSON.stringify(c, null, 2));
    }
  }

  // List endpoint.
  const list = await listBriefComments(client, { briefId });
  console.log(
    `\nlistBriefComments({briefId}) → ${list.data.length} item(s) (totalCount=${list.totalCount})`
  );
  for (const c of list.data) {
    if (String(JSON.stringify(c)).includes("probe-comment")) {
      console.log(`Found probe in list endpoint:`);
      console.log(JSON.stringify(c, null, 2));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
