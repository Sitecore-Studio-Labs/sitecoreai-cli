/**
 * Probe whether the Brief API's `PUT /api/brief/v1/briefs/{id}` accepts
 * any impersonation parameter that changes who shows up as `updatedBy`.
 *
 * Distinct from the POST probe — the user reports that `updatedBy` is
 * the field they care about, so we test PUT specifically (whose
 * `updatedBy` is stamped fresh on every patch, separate from `createdBy`
 * which is set once at create time).
 *
 * Plan:
 *   1. Create a single throwaway brief via the normal POST.
 *   2. PUT it with each candidate impersonation parameter.
 *   3. After each PUT, GET the brief and report `updatedBy`.
 *   4. Delete the throwaway brief.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-brief-update-impersonation.ts <briefTypeId> <auth0Sub>
 */
import {
  createBrief,
  deleteBrief,
  getBrief,
  resolveBriefClient,
} from "@/brief";
import type { BriefApiClientOptions } from "@/brief/api/types";

const SUB = process.argv[3];

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

const CANDIDATES = (sub: string): Candidate[] => [
  { kind: "body", label: "authorId", extras: { authorId: sub } },
  { kind: "body", label: "updatedBy.id", extras: { updatedBy: { id: sub } } },
  { kind: "body", label: "updatedById", extras: { updatedById: sub } },
  { kind: "body", label: "onBehalfOf", extras: { onBehalfOf: sub } },
  { kind: "body", label: "actorId", extras: { actorId: sub } },
  { kind: "header", label: "X-On-Behalf-Of", headers: { "X-On-Behalf-Of": sub } },
  { kind: "header", label: "Sitecore-User-Id", headers: { "Sitecore-User-Id": sub } },
  { kind: "header", label: "X-User-Sub", headers: { "X-User-Sub": sub } },
];

const putWithExtras = async (
  client: BriefApiClientOptions,
  briefId: string,
  candidate: Candidate,
  baseBody: Record<string, unknown>,
): Promise<void> => {
  const url = `${client.baseUrl}/api/brief/v1/briefs/${encodeURIComponent(briefId)}`;
  const body =
    candidate.kind === "body" ? { ...baseBody, ...candidate.extras } : baseBody;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${client.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (candidate.kind === "header") Object.assign(headers, candidate.headers);
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `PUT ${url} → ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`,
    );
  }
};

async function main(): Promise<void> {
  const briefTypeId = process.argv[2];
  if (!briefTypeId || !SUB) {
    console.error(
      "Usage: probe-brief-update-impersonation.ts <briefTypeId> <auth0Sub>",
    );
    process.exit(2);
  }

  const { client } = await resolveBriefClient({});
  const created = await createBrief(client, {
    name: `[probe-update ${new Date().toISOString()}]`,
    briefTypeId,
    locale: "en-us",
    fields: {},
    isTemplate: false,
  });
  console.log(`Created probe brief ${created.id}.`);
  console.log(`Impersonation target sub: ${SUB}\n`);

  try {
    for (const c of CANDIDATES(SUB)) {
      console.log(`--- ${c.kind}: ${c.label} ---`);
      // Vary the name so we know the PUT actually changed something
      // (and not just a stale cache).
      const newName = `[probe-update ${c.kind}/${c.label} ${Date.now()}]`;
      try {
        await putWithExtras(client, created.id, c, { name: newName });
        const got = await getBrief(client, created.id);
        console.log(`  name now: ${got.name.slice(0, 70)}`);
        console.log(`  updatedBy: ${JSON.stringify(got.updatedBy)}`);
        if (got.updatedBy && "id" in got.updatedBy && got.updatedBy.id === SUB) {
          console.log(`  ★ MATCH — updatedBy.id === ${SUB}`);
        } else {
          console.log(`  ✗ no match — server stamped its own caller`);
        }
      } catch (err) {
        console.log(
          `  PUT failed: ${err instanceof Error ? err.message.slice(0, 250) : String(err)}`,
        );
      }
      console.log();
    }
  } finally {
    try {
      await deleteBrief(client, created.id);
      console.log(`Deleted probe brief.`);
    } catch (err) {
      console.warn(
        `Cleanup delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
