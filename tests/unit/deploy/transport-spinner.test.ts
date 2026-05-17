import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { consola } from "consola";
import { installDeployTransportSpinner } from "../../../src/deploy/tasks/transport-spinner";
import { getDeployTransportListener } from "../../../src/deploy/api/common/transport-events";

const oraMocks = vi.hoisted(() => {
  const spinner = { succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() };
  const start = vi.fn(() => spinner);
  const ora = vi.fn(() => ({ start }));
  return { spinner, start, ora };
});

vi.mock("ora", () => ({ default: oraMocks.ora }));

describe("installDeployTransportSpinner", () => {
  const originalTty = process.stdout.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env.SITECOREAI_QUIET;
    delete process.env.SITECOREAI_JSON;
    // Idempotent — installs the listener once for the whole file.
    installDeployTransportSpinner();
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
  });

  const startRequest = (method = "GET", path = "/status", silent = false) =>
    getDeployTransportListener()!.onRequestStart!(method, path, silent);

  it("starts a spinner and exposes succeed/fail handlers", async () => {
    const span = await startRequest("GET", "/health");
    expect(span).not.toBeNull();
    expect(oraMocks.ora).toHaveBeenCalledWith({ text: "GET /health" });
    span?.succeed();
    span?.fail();
    expect(oraMocks.spinner.succeed).toHaveBeenCalled();
    expect(oraMocks.spinner.fail).toHaveBeenCalled();
  });

  it("returns null when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(await startRequest()).toBeNull();
    expect(oraMocks.ora).not.toHaveBeenCalled();
  });

  it("returns null when quiet or JSON mode is enabled", async () => {
    process.env.SITECOREAI_QUIET = "1";
    expect(await startRequest("GET", "/quiet")).toBeNull();

    delete process.env.SITECOREAI_QUIET;
    process.env.SITECOREAI_JSON = "1";
    expect(await startRequest("GET", "/json")).toBeNull();
    expect(oraMocks.ora).not.toHaveBeenCalled();
  });

  it("returns null when silent is true (library callers)", async () => {
    expect(await startRequest("GET", "/silent", true)).toBeNull();
    expect(oraMocks.ora).not.toHaveBeenCalled();
  });

  it("forwards trace lines to consola.debug", () => {
    const debugSpy = vi.spyOn(consola, "debug").mockImplementation(() => {});
    getDeployTransportListener()!.onTrace!("HTTP GET /x");
    expect(debugSpy).toHaveBeenCalledWith("HTTP GET /x");
    debugSpy.mockRestore();
  });
});
