/**
 * Probe whether the Brief API accepts any impersonation parameter
 * on POST /briefs that changes who shows up as `createdBy`.
 *
 * The comments endpoint accepts `authorId` and the server records that
 * as the impersonated `author` while `createdBy` captures the M2M
 * caller. Test whether briefs support the same shape (or any of the
 * common variants).
 *
 * Plan:
 *   - For each candidate (body field name OR header name), create a
 *     throwaway brief with `{authorId | createdBy | onBehalfOf | ...}`
 *     set to a known Auth0 sub.
 *   - GET the brief, report what `createdBy` / `updatedBy` look like.
 *   - DELETE the probe brief.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-brief-author-impersonation.ts <briefTypeId> <auth0Sub>
 */
import { createBrief, deleteBrief, getBrief, listBriefTypes, resolveBriefClient } from "@/brief";
import type { BriefApiClientOptions } from "@/brief/api/types";

interface BodyCandidate {
  kind: "body";
  label: string;
  extras: Record<string, unknown>;
}

interface HeaderCandidate {
  kind: "header";
  label: string;
  headers: Record<string, string>;
}

type Candidate = BodyCandidate | HeaderCandidate;

const sub = process.argv[3];

const CANDIDATES = (sub: string): Candidate[] => [
  { kind: "body", label: "authorId", extras: { authorId: sub } },
  { kind: "body", label: "createdBy.id", extras: { createdBy: { id: sub } } },
  { kind: "body", label: "createdById", extras: { createdById: sub } },
  { kind: "body", label: "onBehalfOf", extras: { onBehalfOf: sub } },
  { kind: "header", label: "X-On-Behalf-Of", headers: { "X-On-Behalf-Of": sub } },
  { kind: "header", label: "Sitecore-User-Id", headers: { "Sitecore-User-Id": sub } },
  { kind: "header", label: "X-User-Sub", headers: { "X-User-Sub": sub } },
];

// briefRequest doesn't expose a header passthrough externally; we'll
// re-implement a minimal POST that the header probe can use.
const postBriefWithExtraHeaders = async (
  client: BriefApiClientOptions,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ id: string }> => {
  const url = `${client.baseUrl}/api/brief/v1/briefs`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} → ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return (await res.json()) as { id: string };
};

async function probeOne(
  client: BriefApiClientOptions,
  briefTypeId: string,
  candidate: Candidate
): Promise<void> {
  const name = `[probe-author ${candidate.kind}/${candidate.label} ${new Date().toISOString()}]`;
  const baseBody = {
    name,
    briefTypeId,
    locale: "en-us",
    fields: {},
    isTemplate: false,
  };

  console.log(`\n--- ${candidate.kind}: ${candidate.label} ---`);
  let briefId: string | undefined;
  try {
    if (candidate.kind === "body") {
      const out = await createBrief(client, {
        ...baseBody,
        ...(candidate.extras as Record<string, never>),
      });
      briefId = out.id;
    } else {
      const out = await postBriefWithExtraHeaders(client, baseBody, candidate.headers);
      briefId = out.id;
    }
    console.log(`Created brief ${briefId}`);
    const got = await getBrief(client, briefId);
    console.log(
      `  createdBy: ${JSON.stringify(got.createdBy)}\n  updatedBy: ${JSON.stringify(got.updatedBy)}`
    );
    if (got.createdBy && "id" in got.createdBy && got.createdBy.id === sub) {
      console.log(`  ★ MATCH — createdBy.id === ${sub}`);
    } else {
      console.log(`  ✗ no match — server stamped its own caller`);
    }
  } catch (err) {
    console.log(`  PUT failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
  } finally {
    if (briefId) {
      try {
        await deleteBrief(client, briefId);
      } catch (err) {
        console.warn(
          `  cleanup delete failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const briefTypeId = process.argv[2];
  if (!briefTypeId || !sub) {
    console.error("Usage: probe-brief-author-impersonation.ts <briefTypeId> <auth0Sub>");
    process.exit(2);
  }

  const { client } = await resolveBriefClient({});
  // Sanity check: brief type exists.
  const types = await listBriefTypes(client);
  const t = types.data.find((x) => x.id === briefTypeId);
  console.log(`Probing brief type ${briefTypeId} (${t?.name ?? "unknown"})`);
  console.log(`Impersonation target sub: ${sub}`);

  for (const c of CANDIDATES(sub)) {
    await probeOne(client, briefTypeId, c);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
