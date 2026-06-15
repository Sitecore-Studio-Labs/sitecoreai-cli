/**
 * `HttpBaselineStorage` — talks to an orchestrator-hosted baseline
 * endpoint instead of the operator filesystem. Implements the same
 * `BaselineStorage` interface as `FileBaselineStorage`, so any kind
 * that opts into three-way merge works against either backend with
 * no call-site changes.
 *
 * Activation is opt-in via env vars that the orchestrator's worker
 * sets before spawning scai:
 *
 *   SYNC_BASELINE_ENDPOINT_URL       Base URL like https://orch/api/v1/sync-baselines
 *   SYNC_BASELINE_AUTH_TOKEN         HMAC-signed bearer scoped to (job, kind, env)
 *   SYNC_BASELINE_PROTECTION_BYPASS  (optional) value for the
 *                                    `x-vercel-protection-bypass` header
 *
 * When the orchestrator endpoint sits behind Vercel Deployment Protection
 * (every preview deployment), the `authorization` bearer alone is not
 * enough — Vercel's auth wall returns a `401 Authentication Required` HTML
 * page at the edge before the request reaches the orchestrator, which this
 * storage would (correctly) treat as a fatal `AUTH_DENIED`. Sending the
 * deployment's "Protection Bypass for Automation" secret as
 * `x-vercel-protection-bypass` lets the call through. The value comes from
 * `SYNC_BASELINE_PROTECTION_BYPASS` if set, else the standard
 * `VERCEL_AUTOMATION_BYPASS_SECRET` system var (which a spawned scai
 * inherits from the orchestrator's Vercel function env). Absent both, no
 * header is sent — operator-local and unprotected deployments are unchanged.
 *
 * Operator CLI invocations don't have these set — they keep using
 * `FileBaselineStorage` against `<configDir>/.scai/baseline/`. Two
 * deployments of scai (operator-local, orchestrator-driven) share
 * exactly one code path; only the storage strategy differs.
 *
 * Endpoint contract:
 *
 *   GET    /:kind/:env/:handle  → 200 Baseline | 404 (no baseline yet)
 *   PUT    /:kind/:env/:handle  → 200 { ok, locator }
 *   DELETE /:kind/:env/:handle  → 200 { ok }
 *
 * 401/403 surface as thrown errors — the kind treats them as
 * non-recoverable (token expired or scope mismatch is an orchestrator
 * misconfiguration, not "no baseline").
 */
import { createScaiError } from "@/shared/errors";
import type { Baseline, BaselineStorage } from "./baseline";

const HANDLE_SEGMENT_ENCODE = (s: string): string =>
  encodeURIComponent(s).replace(/%2F/gi, "/").replace(/%40/gi, "@");

const KIND_PATTERN = /^[a-z][a-z0-9-]*$/;
const ENV_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

export class HttpBaselineStorage implements BaselineStorage {
  constructor(
    readonly endpointUrl: string,
    readonly authToken: string,
    /**
     * Optional Vercel Deployment Protection bypass secret, sent as the
     * `x-vercel-protection-bypass` header so calls reach an orchestrator
     * endpoint behind Vercel's auth wall. Omitted when empty.
     */
    private readonly protectionBypass?: string
  ) {
    if (!endpointUrl) {
      throw createScaiError(
        "HttpBaselineStorage requires a non-empty endpointUrl.",
        "INPUT_INVALID"
      );
    }
    if (!authToken) {
      throw createScaiError("HttpBaselineStorage requires a non-empty authToken.", "INPUT_INVALID");
    }
  }

  private buildUrl(kind: string, envName: string, recipeHandle: string): string {
    if (!KIND_PATTERN.test(kind)) {
      throw createScaiError(
        `Invalid baseline kind "${kind}" — expected lower-kebab slug.`,
        "INPUT_INVALID"
      );
    }
    if (!ENV_PATTERN.test(envName)) {
      throw createScaiError(
        `Invalid baseline env "${envName}" — must start with a letter and contain only alphanumeric / _ . -.`,
        "INPUT_INVALID"
      );
    }
    const base = this.endpointUrl.endsWith("/") ? this.endpointUrl.slice(0, -1) : this.endpointUrl;
    return `${base}/${encodeURIComponent(kind)}/${encodeURIComponent(envName)}/${HANDLE_SEGMENT_ENCODE(recipeHandle)}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.authToken}`,
      accept: "application/json",
    };
    if (this.protectionBypass) {
      headers["x-vercel-protection-bypass"] = this.protectionBypass;
    }
    return headers;
  }

  locator(kind: string, envName: string, recipeHandle: string): string {
    return this.buildUrl(kind, envName, recipeHandle);
  }

  async load<TPayload = unknown>(
    kind: string,
    envName: string,
    recipeHandle: string
  ): Promise<Baseline<TPayload> | null> {
    const url = this.buildUrl(kind, envName, recipeHandle);
    let response: Response;
    try {
      response = await fetch(url, { method: "GET", headers: this.headers() });
    } catch (err) {
      throw createScaiError(
        `Baseline GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
        "NETWORK"
      );
    }
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      throw createScaiError(
        `Baseline GET ${url} unauthorized (${response.status}). Token scope likely mismatched or expired.`,
        "AUTH_DENIED"
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw createScaiError(
        `Baseline GET ${url} returned ${response.status}: ${body.slice(0, 240)}`,
        "DEPLOY_FAILED"
      );
    }
    const json = (await response.json()) as Baseline<TPayload>;
    return json;
  }

  async write<TPayload = unknown>(
    kind: string,
    envName: string,
    recipeHandle: string,
    baseline: Baseline<TPayload>
  ): Promise<string> {
    const url = this.buildUrl(kind, envName, recipeHandle);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify(baseline),
      });
    } catch (err) {
      throw createScaiError(
        `Baseline PUT ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
        "NETWORK"
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw createScaiError(
        `Baseline PUT ${url} unauthorized (${response.status}).`,
        "AUTH_DENIED"
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw createScaiError(
        `Baseline PUT ${url} returned ${response.status}: ${body.slice(0, 240)}`,
        "DEPLOY_FAILED"
      );
    }
    return url;
  }
}

/**
 * Env-var keys the orchestrator sets before spawning scai. Single
 * source of truth shared by every CLI verb that participates in
 * three-way merge.
 */
export const SYNC_BASELINE_ENV_VARS = {
  ENDPOINT_URL: "SYNC_BASELINE_ENDPOINT_URL",
  AUTH_TOKEN: "SYNC_BASELINE_AUTH_TOKEN",
  /** Optional Vercel Deployment Protection bypass secret. */
  PROTECTION_BYPASS: "SYNC_BASELINE_PROTECTION_BYPASS",
} as const;

/**
 * Read env vars and return an `HttpBaselineStorage` instance when
 * both are set, `undefined` otherwise. CLI verbs use this to inject
 * the remote storage when the orchestrator drives them; operator
 * invocations from a terminal fall through to local file storage.
 *
 * The protection-bypass value is optional: an explicit
 * `SYNC_BASELINE_PROTECTION_BYPASS` wins; otherwise the standard Vercel
 * `VERCEL_AUTOMATION_BYPASS_SECRET` (inherited from the orchestrator's
 * function env) is used so a protected preview endpoint works with no
 * extra orchestrator config. Empty/unset → no bypass header.
 */
export const resolveHttpBaselineStorageFromEnv = (): HttpBaselineStorage | undefined => {
  const url = process.env[SYNC_BASELINE_ENV_VARS.ENDPOINT_URL];
  const token = process.env[SYNC_BASELINE_ENV_VARS.AUTH_TOKEN];
  if (!url || !token) return undefined;
  const bypass =
    process.env[SYNC_BASELINE_ENV_VARS.PROTECTION_BYPASS]?.trim() ||
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ||
    undefined;
  return new HttpBaselineStorage(url, token, bypass);
};
