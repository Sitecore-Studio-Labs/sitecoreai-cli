/**
 * Brief Types write-contract probe.
 *
 * The Brief API has list+get for `BriefType` but we never verified
 * whether types are user-mutable. This script probes the write surface
 * (POST/PUT/DELETE on `/api/brief/v1/brief-types`) so we know whether to
 * wire `createBriefType` / `updateBriefType` / `deleteBriefType` into the
 * SDK and surface them via the CLI / MCP.
 *
 * Sequence (all idempotent or self-cleaning):
 *   1. OPTIONS  /brief-types         — discover allowed verbs on the collection
 *   2. GET      /brief-types?Limit=1 — confirm read still works (sanity)
 *   3. POST     /brief-types         — try a minimal create; record status/body
 *   4. POST     /brief-types         — retry with a richer body if first failed 4xx
 *   5. OPTIONS  /brief-types/{id}    — if create yielded an id, discover item verbs
 *   6. PUT      /brief-types/{id}    — try update
 *   7. DELETE   /brief-types/{id}    — best-effort cleanup
 *
 * Output is JSON to stdout (one record per request) and a human log to
 * stderr. Run twice: read-only first to confirm the OPTIONS/sanity calls
 * look sane, then with --destructive to actually attempt writes.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brief-types-write.ts AGENTS [--destructive]
 *
 * Auth: uses `acquireBriefToken`, which reads the cached Brief JWT from
 * the OS keychain (`SitecoreAI CLI / brief:<envName>`) before falling
 * back to client_credentials. The env profile in `sitecoreai.cli.json`
 * supplies clientId/authority/audience; the secret only matters if the
 * keychain entry is missing or expired.
 */
import { acquireBriefToken } from "@/brief";

const DEFAULT_BASE = "https://co-brief-api-euw.sitecorecloud.io";

type ProbeRecord = {
  step: string;
  method: string;
  path: string;
  status: number;
  contentType: string | null;
  allow: string | null;
  bodySent?: unknown;
  bodyPreview: string;
  parsed?: unknown;
};

const runRequest = async (
  baseUrl: string,
  token: string,
  step: string,
  method: string,
  path: string,
  body?: unknown
): Promise<ProbeRecord> => {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const preview = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  process.stderr.write(
    `  ${response.status.toString().padStart(3)} ${method.padEnd(7)} ${path}  [${step}]\n`
  );
  return {
    step,
    method,
    path,
    status: response.status,
    contentType: response.headers.get("content-type"),
    allow: response.headers.get("allow"),
    bodySent: body,
    bodyPreview: preview,
    parsed,
  };
};

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const destructive = process.argv.includes("--destructive");
  const baseUrl = process.argv.find((a) => a.startsWith("https://")) ?? DEFAULT_BASE;

  if (!envName) {
    process.stderr.write(
      "Usage: tsx scripts/_smoke-brief-types-write.ts <ENV> [--destructive] [BASE_URL]\n"
    );
    process.exit(2);
  }

  process.stderr.write(`> loading env profile '${envName}' from sitecoreai.cli.json\n`);
  const rootConfig = (await import("@/config/root-config")).readRootConfiguration(
    "./sitecoreai.cli.json",
    envName
  );
  const environment = rootConfig.environments[envName];
  if (!environment) {
    process.stderr.write(`Env profile '${envName}' not in sitecoreai.cli.json\n`);
    process.exit(2);
  }

  process.stderr.write(`> acquiring brief token (keychain first, M2M fallback)\n`);
  const token = await acquireBriefToken({ envName, environment });
  process.stderr.write(`> token len=${token.length}\n`);
  process.stderr.write(`> base=${baseUrl}\n`);
  process.stderr.write(`> destructive=${destructive}\n\n`);

  const records: ProbeRecord[] = [];

  records.push(
    await runRequest(baseUrl, token, "collection-options", "OPTIONS", "/api/brief/v1/brief-types")
  );
  const sanityRecord = await runRequest(
    baseUrl,
    token,
    "collection-read-sanity",
    "GET",
    "/api/brief/v1/brief-types?Limit=1"
  );
  records.push(sanityRecord);

  // Probe item-level verbs against an existing id without touching it.
  // OPTIONS on `/brief-types/{id}` reveals the item allow set so we know
  // ahead of the destructive pass whether PUT/DELETE are even on offer.
  const firstExisting =
    sanityRecord.parsed &&
    typeof sanityRecord.parsed === "object" &&
    "data" in (sanityRecord.parsed as Record<string, unknown>)
      ? ((sanityRecord.parsed as Record<string, unknown>).data as Array<{ id: string }>)[0]
      : undefined;
  if (firstExisting?.id) {
    records.push(
      await runRequest(
        baseUrl,
        token,
        "item-options-existing",
        "OPTIONS",
        `/api/brief/v1/brief-types/${firstExisting.id}`
      )
    );
  }

  if (!destructive) {
    process.stderr.write("\n(skipping POST/PUT/DELETE; pass --destructive to attempt writes)\n");
    process.stdout.write(`${JSON.stringify({ baseUrl, records }, null, 2)}\n`);
    return;
  }

  // Build a plausible BriefType payload. Pull one existing type to learn
  // the field-shape, then clone its structure under a probe-marked name.
  const existing =
    sanityRecord.parsed &&
    typeof sanityRecord.parsed === "object" &&
    "data" in (sanityRecord.parsed as Record<string, unknown>)
      ? ((sanityRecord.parsed as Record<string, unknown>).data as unknown[])[0]
      : undefined;

  const probeStamp = Date.now();
  const probeName = `ScaiProbe_${probeStamp}`;

  // Minimal payload — required-ish fields only.
  const minimalBody: Record<string, unknown> = {
    name: probeName,
    label: { "en-us": "scai probe (delete me)" },
    description: "Probe payload — created by scripts/_smoke-brief-types-write.ts. Safe to delete.",
    icon: "FileDocumentOutline",
    iconColor: "#FF00AA",
    fields: [],
  };

  records.push(
    await runRequest(
      baseUrl,
      token,
      "post-minimal",
      "POST",
      "/api/brief/v1/brief-types",
      minimalBody
    )
  );

  // If the minimal POST failed with 4xx (validation), retry with a richer
  // payload modelled on an existing type. Skip on 401/403/405 — those are
  // permission/method answers, not shape answers.
  const lastPost = records[records.length - 1];
  let createdId: string | null = null;
  if (lastPost.status >= 200 && lastPost.status < 300) {
    createdId =
      ((lastPost.parsed as Record<string, unknown> | undefined)?.id as string | undefined) ?? null;
  } else if (
    lastPost.status >= 400 &&
    lastPost.status < 500 &&
    lastPost.status !== 401 &&
    lastPost.status !== 403 &&
    lastPost.status !== 405 &&
    existing &&
    typeof existing === "object"
  ) {
    const richBody: Record<string, unknown> = {
      ...(existing as Record<string, unknown>),
      name: probeName,
      label: { "en-us": "scai probe (delete me)" },
      description: "Probe payload — rich shape variant.",
    };
    delete richBody.id;
    delete richBody.createdOn;
    delete richBody.createdBy;
    delete richBody.updatedOn;
    delete richBody.updatedBy;
    records.push(
      await runRequest(baseUrl, token, "post-rich", "POST", "/api/brief/v1/brief-types", richBody)
    );
    const retry = records[records.length - 1];
    if (retry.status >= 200 && retry.status < 300) {
      createdId =
        ((retry.parsed as Record<string, unknown> | undefined)?.id as string | undefined) ?? null;
    }
  }

  if (createdId) {
    process.stderr.write(`\n> probe type created: id=${createdId}\n`);
    records.push(
      await runRequest(
        baseUrl,
        token,
        "item-options",
        "OPTIONS",
        `/api/brief/v1/brief-types/${createdId}`
      )
    );
    records.push(
      await runRequest(
        baseUrl,
        token,
        "put-update",
        "PUT",
        `/api/brief/v1/brief-types/${createdId}`,
        { ...minimalBody, description: "Probe payload — updated via PUT." }
      )
    );
    records.push(
      await runRequest(
        baseUrl,
        token,
        "delete-cleanup",
        "DELETE",
        `/api/brief/v1/brief-types/${createdId}`
      )
    );
  } else {
    process.stderr.write(
      `\n> no createdId — skipping item-level probes. (status of POST: ${lastPost.status})\n`
    );
  }

  process.stdout.write(`${JSON.stringify({ baseUrl, records }, null, 2)}\n`);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
