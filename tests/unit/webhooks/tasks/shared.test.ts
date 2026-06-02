import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMocks = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(),
}));
const clientMocks = vi.hoisted(() => ({
  createWebhookApiClient: vi.fn(),
}));

vi.mock("../../../../src/policy/environment", () => envMocks);
vi.mock("../../../../src/webhooks/api/client", () => clientMocks);

import {
  printWebhookResult,
  resolveWebhookTenant,
  toLogger,
} from "../../../../src/webhooks/tasks/shared";

beforeEach(() => {
  envMocks.resolveEnvironment.mockReset();
  clientMocks.createWebhookApiClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveWebhookTenant", () => {
  it("composes resolveEnvironment + createWebhookApiClient and returns the resolved bundle", () => {
    const environment = { host: "https://tenant.example" };
    const root = { environments: {} };
    const client = { listEventHandlers: vi.fn() };
    envMocks.resolveEnvironment.mockReturnValue({
      envName: "dev",
      environment,
      root,
      timeoutMs: 30_000,
    });
    clientMocks.createWebhookApiClient.mockReturnValue(client);

    const result = resolveWebhookTenant({ environmentName: "dev" });

    expect(envMocks.resolveEnvironment).toHaveBeenCalledWith({ environmentName: "dev" });
    expect(clientMocks.createWebhookApiClient).toHaveBeenCalledWith({
      environment,
      request: { timeoutMs: 30_000 },
    });
    expect(result).toEqual({ envName: "dev", environment, root, client });
  });

  it("threads through undefined timeoutMs (resolveEnvironment may not set one)", () => {
    envMocks.resolveEnvironment.mockReturnValue({
      envName: "prod",
      environment: { host: "x" },
      root: { environments: {} },
      timeoutMs: undefined,
    });
    clientMocks.createWebhookApiClient.mockReturnValue({});

    resolveWebhookTenant({});

    expect(clientMocks.createWebhookApiClient).toHaveBeenCalledWith({
      environment: { host: "x" },
      request: { timeoutMs: undefined },
    });
  });
});

describe("printWebhookResult — output branch selection", () => {
  const baseParams = {
    command: "webhook:list",
    envName: "dev",
    result: { items: ["a", "b"] },
  };

  const stubLogger = (isJson: boolean) => {
    const info = vi.fn();
    const json = vi.fn();
    return {
      logger: { info, json, isJson: () => isJson } as never,
      info,
      json,
    };
  };

  it("emits a single envelope via logger.json() when --json is on", () => {
    const { logger, info, json } = stubLogger(true);
    printWebhookResult({ ...baseParams, logger, humanLines: ["unused"] });

    expect(json).toHaveBeenCalledExactlyOnceWith({
      command: "webhook:list",
      environment: "dev",
      result: { items: ["a", "b"] },
    });
    expect(info).not.toHaveBeenCalled();
  });

  it("prints the supplied humanLines when not --json", () => {
    const { logger, info, json } = stubLogger(false);
    printWebhookResult({
      ...baseParams,
      logger,
      humanLines: ["line 1", "line 2"],
    });

    expect(json).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(1, "line 1");
    expect(info).toHaveBeenNthCalledWith(2, "line 2");
  });

  it("falls back to pretty-JSON of the result when no humanLines are provided", () => {
    const { logger, info } = stubLogger(false);
    printWebhookResult({ ...baseParams, logger });

    expect(info).toHaveBeenCalledExactlyOnceWith(JSON.stringify(baseParams.result, null, 2));
  });

  it("falls back to pretty-JSON when humanLines is provided but empty", () => {
    const { logger, info } = stubLogger(false);
    printWebhookResult({ ...baseParams, logger, humanLines: [] });

    expect(info).toHaveBeenCalledExactlyOnceWith(JSON.stringify(baseParams.result, null, 2));
  });
});

describe("toLogger — flag coercion + env fallback", () => {
  const originalEnv = process.env.SITECOREAI_LOG_FILE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SITECOREAI_LOG_FILE;
    else process.env.SITECOREAI_LOG_FILE = originalEnv;
  });

  it("constructs a Logger with all flags off when nothing is passed", () => {
    delete process.env.SITECOREAI_LOG_FILE;
    const logger = toLogger({});
    expect(logger.isJson()).toBe(false);
  });

  it("respects options.json", () => {
    const logger = toLogger({ json: true });
    expect(logger.isJson()).toBe(true);
  });

  it("falls back to SITECOREAI_LOG_FILE env when options.logFile is not set", () => {
    process.env.SITECOREAI_LOG_FILE = "/tmp/from-env.log";
    expect(() => toLogger({})).not.toThrow();
  });

  it("prefers options.logFile over the env fallback", () => {
    process.env.SITECOREAI_LOG_FILE = "/tmp/from-env.log";
    expect(() => toLogger({ logFile: "/tmp/from-opt.log" })).not.toThrow();
  });
});
