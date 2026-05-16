import { createScaiError } from "@/shared/errors";
import type {
  CreatePublishJobRequest,
  ListPublishJobsQuery,
  PublishJob,
  PublishJobResponse,
  PublishJobState,
  PublishJobStatusWire,
  PublishingApiClientOptions,
} from "./types";

const DEFAULT_BASE_URL = "https://edge-platform.sitecorecloud.io";
const JOBS_PATH = "/authoring/publishing/v1/jobs";

interface PublishingFetchOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | string[] | undefined>;
}

const buildQueryString = (query?: PublishingFetchOptions["query"]): string => {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
};

const fetchPublishingApi = async (
  client: PublishingApiClientOptions,
  options: PublishingFetchOptions
): Promise<unknown> => {
  const baseUrl = client.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}${JOBS_PATH}${options.path}${buildQueryString(options.query)}`;
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

    if (response.status === 202 || response.status === 204) {
      return undefined;
    }

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "AUTH_REQUIRED" : "NETWORK";
      const hint =
        response.status === 403
          ? "The token is valid but the API refused the call. Verify the env-level automation client has xmcpub.jobs.t:r/w grants. Body: " +
            text.slice(0, 400)
          : text.slice(0, 400) || response.statusText || undefined;
      throw createScaiError(
        `Publishing API ${options.method} ${url} returned ${response.status}.`,
        code,
        { hint }
      );
    }
    if (!text) return undefined;
    return JSON.parse(text);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const STATUS_TO_STATE: Record<PublishJobStatusWire, PublishJobState> = {
  Queued: "queued",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Canceled: "cancelled",
  Canceling: "cancelling",
};

const normalizeState = (raw: string | undefined): PublishJobState =>
  STATUS_TO_STATE[(raw ?? "Queued") as PublishJobStatusWire] ?? "queued";

const normalizeJob = (raw: PublishJobResponse): PublishJob => {
  const stats = (raw.statistics ?? {}) as Record<string, unknown>;
  // The Publishing API exposes statistics under two field sets:
  //   - flat `processedCount` / `totalCount` (older deployments)
  //   - rich `itemsSent` / `itemsProcessed` / `itemsFailed` (observed
  //     live against Agents 2026-05-14)
  // Prefer the rich set; fall back to flat.
  const itemsProcessed =
    typeof stats.itemsProcessed === "number" ? stats.itemsProcessed : undefined;
  const itemsSent = typeof stats.itemsSent === "number" ? stats.itemsSent : undefined;
  const flatProcessed = typeof stats.processedCount === "number" ? stats.processedCount : undefined;
  const flatTotal = typeof stats.totalCount === "number" ? stats.totalCount : undefined;

  const state = normalizeState(raw.system?.status);
  // `permissions.canCancel` is a *permission* flag (caller has cancel
  // rights), not a *state* flag (the job is currently cancellable).
  // The API returns `true` even on completed jobs because permission
  // doesn't change. Combine both so callers get a useful "actually
  // cancellable now" signal.
  const stateIsCancellable = state === "queued" || state === "running";

  return {
    id: raw.id,
    state,
    name: raw.name ?? undefined,
    source: raw.source ?? undefined,
    processedCount: itemsProcessed ?? flatProcessed,
    totalCount: itemsSent ?? flatTotal,
    startedAt: raw.system?.startTime ?? undefined,
    completedAt: raw.system?.finishTime ?? undefined,
    canCancel: Boolean(raw.permissions?.canCancel) && stateIsCancellable,
    raw,
  };
};

export const submitPublishJob = async (
  client: PublishingApiClientOptions,
  request: CreatePublishJobRequest
): Promise<PublishJob> => {
  const raw = (await fetchPublishingApi(client, {
    method: "POST",
    path: "",
    body: request,
  })) as PublishJobResponse;
  return normalizeJob(raw);
};

export const getPublishJob = async (
  client: PublishingApiClientOptions,
  jobId: string
): Promise<PublishJob> => {
  if (!jobId) {
    throw createScaiError("Publish job id is required.", "INPUT_INVALID");
  }
  const raw = (await fetchPublishingApi(client, {
    method: "GET",
    path: `/${encodeURIComponent(jobId)}`,
  })) as PublishJobResponse;
  return normalizeJob(raw);
};

export const cancelPublishJob = async (
  client: PublishingApiClientOptions,
  jobId: string
): Promise<void> => {
  if (!jobId) {
    throw createScaiError("Publish job id is required.", "INPUT_INVALID");
  }
  await fetchPublishingApi(client, {
    method: "POST",
    path: `/${encodeURIComponent(jobId)}/cancel`,
  });
};

export const listPublishJobs = async (
  client: PublishingApiClientOptions,
  options: ListPublishJobsQuery = {}
): Promise<PublishJob[]> => {
  const query: PublishingFetchOptions["query"] = {};
  if (options.pageNumber !== undefined) query.pageNumber = options.pageNumber;
  if (options.pageSize !== undefined) query.pageSize = options.pageSize;
  if (options.statuses?.length) query["system.status"] = options.statuses;
  if (options.source?.length) query.source = options.source;

  const raw = (await fetchPublishingApi(client, {
    method: "GET",
    path: "",
    query,
  })) as { data?: PublishJobResponse[] } | PublishJobResponse[] | undefined;

  const list = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return list.map(normalizeJob);
};
