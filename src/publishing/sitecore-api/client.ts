import { createScaiError } from "@/shared/errors";
import type { PublishJob, PublishJobState, PublishingApiClientOptions } from "./types";

const DEFAULT_BASE_URL = "https://edge-platform.sitecorecloud.io";
const JOBS_PATH = "/authoring/publishing/v1/jobs";

interface PublishingFetchOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

const fetchPublishingApi = async (
  client: PublishingApiClientOptions,
  options: PublishingFetchOptions
): Promise<unknown> => {
  const baseUrl = client.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}${JOBS_PATH}${options.path}`;
  const controller = client.timeoutMs ? new AbortController() : undefined;
  const timer =
    controller && client.timeoutMs
      ? setTimeout(() => controller.abort(), client.timeoutMs)
      : undefined;

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller?.signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        // upstream body unreadable — surface status alone
      }
      // 403 from the Publishing API almost always means the automation
      // client's JWT lacks publishing scopes. The API host accepts the
      // tenant's token issuer but rejects the call. Point operators at
      // the fix instead of just printing "Forbidden".
      const hint =
        response.status === 403
          ? "The automation client's JWT does not include publishing scopes. In the Sitecore Cloud Portal, edit the automation client for this environment and add the publishing scopes, then re-run 'scai login'."
          : detail || response.statusText || undefined;
      throw createScaiError(
        `Publishing API ${options.method} ${url} returned ${response.status}.`,
        response.status === 401 || response.status === 403 ? "AUTH_REQUIRED" : "NETWORK",
        { hint }
      );
    }
    if (response.status === 204) {
      return undefined;
    }
    return await response.json();
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const KNOWN_STATES = new Set<PublishJobState>([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Map whatever the API returns into our PublishJobState union. The
 * Redoc page doesn't pin the wire form; accept the obvious variants
 * ("canceled" US spelling, capitalised values) and fall back to
 * "queued" so downstream code can rely on the union.
 */
const normalizeState = (raw: unknown): PublishJobState => {
  const value = String(raw ?? "").toLowerCase();
  if (value === "canceled") {
    return "cancelled";
  }
  if (KNOWN_STATES.has(value as PublishJobState)) {
    return value as PublishJobState;
  }
  return "queued";
};

const normalizeJob = (raw: unknown): PublishJob => {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(obj.id ?? obj.jobId ?? ""),
    state: normalizeState(obj.state ?? obj.stateName ?? obj.status),
    processedCount: typeof obj.processedCount === "number" ? obj.processedCount : undefined,
    totalCount: typeof obj.totalCount === "number" ? obj.totalCount : undefined,
    startedAt: typeof obj.startedAt === "string" ? obj.startedAt : undefined,
    completedAt: typeof obj.completedAt === "string" ? obj.completedAt : undefined,
  };
};

export const getPublishJob = async (
  client: PublishingApiClientOptions,
  jobId: string
): Promise<PublishJob> => {
  if (!jobId) {
    throw createScaiError("Publish job id is required.", "INPUT_INVALID");
  }
  const raw = await fetchPublishingApi(client, {
    method: "GET",
    path: `/${encodeURIComponent(jobId)}`,
  });
  return normalizeJob(raw);
};

export interface ListPublishJobsOptions {
  /** Limit to jobs in these states. Default: queued + running. */
  states?: PublishJobState[];
}

export const listPublishJobs = async (
  client: PublishingApiClientOptions,
  options: ListPublishJobsOptions = {}
): Promise<PublishJob[]> => {
  const raw = await fetchPublishingApi(client, {
    method: "GET",
    path: "",
  });
  // The catalog mentions offset + checkpoint pagination but doesn't
  // pin the wrapper shape. Accept both `[...]` and `{ items: [...] }`
  // until a real-tenant capture lets us tighten this.
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { items?: unknown[]; data?: unknown[] })?.items ??
      (raw as { data?: unknown[] })?.data ??
      []);
  const jobs = (Array.isArray(list) ? list : []).map(normalizeJob);
  const states = options.states ?? ["queued", "running"];
  if (states.length === 0) {
    return jobs;
  }
  const wanted = new Set(states);
  return jobs.filter((job) => wanted.has(job.state));
};
