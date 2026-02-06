import { consola } from "consola";
import { redactSecrets } from "../../../shared/redact";
import { createCliError } from "../../../shared/errors";
import {
  DEFAULT_DEPLOY_API_BASE,
  DeployApiClientOptions,
  DeployQueryValueList,
  DeployRequestInit,
} from "./types";

const toQueryString = (query?: Record<string, DeployQueryValueList | undefined>): string => {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, String(entry));
      }
      continue;
    }
    params.set(key, String(value));
  }
  const output = params.toString();
  return output ? `?${output}` : "";
};

const withJitter = (value: number): number => {
  const jitter = 0.5 + Math.random();
  return Math.round(value * jitter);
};

export const parseJsonIfPossible = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const extractErrorMessage = (body: unknown): string | undefined => {
  if (typeof body === "string") {
    return body;
  }
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const candidates = [record.detail, record.message, record.title, record.error];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  if (Array.isArray(record.errors)) {
    const parts = record.errors
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object") {
          const entryRecord = entry as Record<string, unknown>;
          const entryMessage = entryRecord.message ?? entryRecord.detail ?? entryRecord.error;
          if (typeof entryMessage === "string") {
            return entryMessage;
          }
        }
        return undefined;
      })
      .filter((value): value is string => Boolean(value));
    if (parts.length > 0) {
      return parts.join("; ");
    }
  }
  if (record.errors && typeof record.errors === "object" && !Array.isArray(record.errors)) {
    try {
      return JSON.stringify(record.errors);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

type SpinnerHandle = { succeed: () => void; fail: () => void; stop: () => void };

const activeSpinners = new Set<SpinnerHandle>();
let handlersInstalled = false;

const installHandlers = (): void => {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;
  const cleanup = () => {
    for (const spinner of activeSpinners) {
      try {
        spinner.stop();
      } catch {
        // ignore spinner cleanup failures
      }
    }
    activeSpinners.clear();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);
};

export const startDeploySpinner = async (
  text: string
): Promise<{ succeed: () => void; fail: () => void } | null> => {
  if (!process.stdout.isTTY) {
    return null;
  }
  if (process.env.SITECOREAI_QUIET === "1" || process.env.SITECOREAI_JSON === "1") {
    return null;
  }
  const { default: ora } = await import("ora");
  const spinner = ora({ text }).start();
  const handle: SpinnerHandle = {
    succeed: () => {
      spinner.succeed();
      activeSpinners.delete(handle);
    },
    fail: () => {
      spinner.fail();
      activeSpinners.delete(handle);
    },
    stop: () => {
      spinner.stop();
      activeSpinners.delete(handle);
    },
  };
  activeSpinners.add(handle);
  installHandlers();
  return { succeed: handle.succeed, fail: handle.fail };
};

export const deployRequest = async <T>(
  options: DeployApiClientOptions,
  path: string,
  query?: Record<string, DeployQueryValueList | undefined>,
  init?: DeployRequestInit
): Promise<T> => {
  const baseUrl = options.baseUrl ?? DEFAULT_DEPLOY_API_BASE;
  const url = `${baseUrl.replace(/\/$/, "")}${path}${toQueryString(query)}`;
  const method = init?.method ? init.method.toUpperCase() : "GET";
  const spinner = await startDeploySpinner(`${method} ${path}`);
  if (init?.whatIf) {
    spinner?.succeed();
    return {
      whatIf: true,
      request: {
        method,
        path,
        url,
        query,
        body: init?.body,
      },
    } as T;
  }
  const traceEnabled = process.env.SITECOREAI_TRACE_HTTP === "1";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    Accept: "application/json",
  };
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  }
  const maxRetries = Number(process.env.SITECOREAI_HTTP_RETRIES ?? 2);
  const retryBaseMs = Number(process.env.SITECOREAI_HTTP_RETRY_BASE_MS ?? 500);
  const shouldRetry = (status?: number): boolean =>
    method === "GET" && (status === 429 || (status !== undefined && status >= 500));

  let response: Response;
  let attempt = 0;
  while (true) {
    try {
      if (traceEnabled) {
        consola.debug(`HTTP ${method} ${url}`);
      }
      response = await fetch(url, {
        method,
        headers,
        body,
      });
    } catch {
      if (attempt < maxRetries && method === "GET") {
        attempt += 1;
        const delay = withJitter(retryBaseMs * Math.pow(2, attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      spinner?.fail();
      throw createCliError("Deploy API request failed due to a network error.", "NETWORK", {
        hint: "Check network connectivity or try again later.",
      });
    }

    if (!response.ok && shouldRetry(response.status) && attempt < maxRetries) {
      attempt += 1;
      const delay = withJitter(retryBaseMs * Math.pow(2, attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    break;
  }

  if (!response.ok) {
    spinner?.fail();
    const body = await parseJsonIfPossible(response);
    const message = extractErrorMessage(body);
    const sanitized = message ? redactSecrets(message) : undefined;
    throw createCliError(
      sanitized ?? `Deploy API request failed (${response.status})`,
      "DEPLOY_FAILED"
    );
  }

  spinner?.succeed();
  if (traceEnabled) {
    consola.debug(`HTTP ${method} ${path} -> ${response.status}`);
  }
  return (await parseJsonIfPossible(response)) as T;
};
