/**
 * Canonical scai output envelope.
 *
 * Every CLI command emits this shape under `--json` (with optional keys
 * absent when N/A). Agents and downstream automation branch on `data`
 * regardless of which surface produced the output; the rest of the
 * keys carry structured metadata (counts, pagination, plan-only flag,
 * baseline ignore count, etc.) in canonical slots.
 *
 *   {
 *     "command": "deploy.environments.list",
 *     "environment": "demo",
 *     "data": <T>,            // primary result (object, array, scalar, or null)
 *     "count"?: number,       // present when data is an array
 *     "totalCount"?: number,  // present when paginated and known
 *     "pageSize"?: number,    // present when paginated
 *     "whatIf"?: true,        // present iff plan-only
 *     "ignoredCount"?: number,// present when baseline filtering applied
 *     "summary"?: string,     // human-readable headline
 *     "meta"?: Record<string, unknown>  // command-specific extras
 *   }
 *
 * Prior to 2026-05-14, three different keys held the same slot:
 * `result` (deploy commands), `results` (hygiene audit/cleanup), and
 * `request` (deploy what-if). Agents parsing scai output had to branch
 * on shape per-command. The unification renames all three to `data`.
 *
 * The module lives in `src/shared/` so any task surface (deploy,
 * hygiene, serialization, recipe, workflow, webhook) can import it
 * without crossing layer boundaries.
 */
export interface ScaiEnvelope<T = unknown> {
  command: string;
  environment: string | null;
  data: T;
  count?: number;
  totalCount?: number;
  pageSize?: number;
  whatIf?: true;
  ignoredCount?: number;
  summary?: string;
  meta?: Record<string, unknown>;
}

const CANONICAL_ENVELOPE_KEYS = new Set<keyof ScaiEnvelope>([
  "count",
  "totalCount",
  "pageSize",
  "whatIf",
  "ignoredCount",
  "summary",
]);

/**
 * Build a `ScaiEnvelope` from a primary `data` value plus an `extra`
 * bag. Keys in `extra` that match canonical envelope fields are
 * hoisted to envelope-level; everything else collects under `meta`.
 * Auto-computes `count` when `data` is an array (overridable via
 * `extra.count`).
 */
export const buildScaiEnvelope = <T>(params: {
  command: string;
  environment: string | null | undefined;
  data: T;
  extra?: Record<string, unknown>;
}): ScaiEnvelope<T> => {
  const envelope: ScaiEnvelope<T> = {
    command: params.command,
    environment: params.environment ?? null,
    data: params.data,
  };
  if (Array.isArray(params.data)) {
    envelope.count = params.data.length;
  }
  const meta: Record<string, unknown> = {};
  const envelopeBag = envelope as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(params.extra ?? {})) {
    if (CANONICAL_ENVELOPE_KEYS.has(key as keyof ScaiEnvelope)) {
      envelopeBag[key] = value;
    } else {
      meta[key] = value;
    }
  }
  if (Object.keys(meta).length > 0) {
    envelope.meta = meta;
  }
  return envelope;
};

/**
 * Read the entire stdin to a string, then parse a `ScaiEnvelope`.
 * Used by cleanup commands that accept `--from-stdin` to consume an
 * audit's `--json` output directly, skipping their internal re-run of
 * the audit. The contract: callers expect a single JSON object that
 * matches the canonical envelope. Extra keys are tolerated;
 * `command`, `data` are required.
 *
 * Returns the parsed envelope cast to the expected `data` shape (no
 * structural validation beyond key presence — the cleanup task layer
 * runs its own zod validation on the items in `data`).
 */
export const readScaiEnvelopeFromStdin = async <T = unknown>(): Promise<ScaiEnvelope<T>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) {
    throw new Error("--from-stdin: stdin was empty. Pipe an audit's --json output in.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `--from-stdin: stdin was not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
      { cause: error }
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--from-stdin: expected a JSON object (a ScaiEnvelope), got something else.");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.command !== "string") {
    throw new Error("--from-stdin: envelope is missing the required `command` field.");
  }
  if (!("data" in obj)) {
    throw new Error("--from-stdin: envelope is missing the required `data` field.");
  }
  return obj as unknown as ScaiEnvelope<T>;
};
