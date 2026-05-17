/**
 * Brief status-transition probe.
 *
 * Verifies whether a brief's `status` can be changed via the Brief API
 * — the precondition for linking a brief to a campaign (campaigns
 * reject briefs still in `Draft`).
 *
 * `Draft → Approved` via a plain `{ status }` PUT is confirmed working.
 * `In Review` was rejected — this probe captures the raw validation
 * body and tries candidate wire spellings to pin the exact enum value.
 *
 * Self-cleaning: creates a throwaway brief and deletes it at the end.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brief-status-write.ts agents
 */
import { acquireBriefToken } from "@/brief";
import { readRootConfiguration } from "@/config/root-config";
import { createBrief, deleteBrief, getBrief } from "@/brief/api/briefs";
import { DEFAULT_BRIEF_API_BASE } from "@/brief/api/types";
import type { BriefApiClientOptions } from "@/brief/api/types";

const CREATIVE_BRIEF_TYPE_ID = "487b2c26-0019-4cc4-8b0a-a411aedf0991";

/** Candidate wire spellings for the "In Review" status. */
const IN_REVIEW_CANDIDATES = ["In Review", "InReview", "IN_REVIEW", "In_Review", "Review"];

/** Raw PUT to /briefs/{id} so we can see the un-mapped error body. */
const rawPutStatus = async (
  token: string,
  briefId: string,
  status: string
): Promise<{ httpStatus: number; body: string }> => {
  const response = await fetch(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs/${briefId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  const text = await response.text();
  return { httpStatus: response.status, body: text.length > 500 ? `${text.slice(0, 500)}…` : text };
};

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "agents";
  const root = readRootConfiguration("./sitecoreai.cli.json", envName);
  const environment = root.environments[envName];
  if (!environment) {
    process.stderr.write(`Env profile '${envName}' not in sitecoreai.cli.json\n`);
    process.exit(2);
  }

  const accessToken = await acquireBriefToken({ envName, environment });
  const client: BriefApiClientOptions = { accessToken };

  process.stderr.write(`> creating throwaway brief\n`);
  const created = await createBrief(client, {
    name: `scai probe status ${Date.now()} (delete me)`,
    briefTypeId: CREATIVE_BRIEF_TYPE_ID,
    locale: "en-us",
    fields: {},
    isTemplate: false,
  });
  process.stderr.write(`> created ${created.id}, status=${JSON.stringify(created.status)}\n`);

  const log: Record<string, unknown>[] = [];

  try {
    for (const candidate of IN_REVIEW_CANDIDATES) {
      const result = await rawPutStatus(accessToken, created.id, candidate);
      let confirmedStatus: string | undefined;
      if (result.httpStatus >= 200 && result.httpStatus < 300) {
        confirmedStatus = (await getBrief(client, created.id)).status;
      }
      const ok =
        confirmedStatus === candidate || (result.httpStatus >= 200 && result.httpStatus < 300);
      log.push({
        candidate,
        httpStatus: result.httpStatus,
        confirmedStatus,
        body: result.body,
        ok,
      });
      process.stderr.write(
        `  ${ok ? "OK  " : "FAIL"} '${candidate}' -> ${result.httpStatus}${confirmedStatus ? ` (now ${confirmedStatus})` : ""}\n`
      );
      // Reset to Draft between tries so each candidate starts clean.
      if (ok) {
        await rawPutStatus(accessToken, created.id, "Draft");
      }
    }
  } finally {
    try {
      await deleteBrief(client, created.id);
      process.stderr.write(`> deleted throwaway brief ${created.id}\n`);
    } catch (error) {
      process.stderr.write(`> WARNING: could not delete ${created.id}: ${String(error)}\n`);
    }
  }

  process.stdout.write(`${JSON.stringify({ envName, log }, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
