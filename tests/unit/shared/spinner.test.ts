import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const oraMocks = vi.hoisted(() => {
  const spinner = {
    succeed: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  };
  const start = vi.fn(() => spinner);
  const ora = vi.fn(() => ({ start }));
  return { spinner, start, ora };
});

vi.mock("ora", () => ({
  default: oraMocks.ora,
}));

describe("startSpinner", () => {
  const originalTty = process.stdout.isTTY;
  const originalQuiet = process.env.SITECOREAI_QUIET;
  const originalJson = process.env.SITECOREAI_JSON;

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env.SITECOREAI_QUIET;
    delete process.env.SITECOREAI_JSON;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    if (originalQuiet === undefined) {
      delete process.env.SITECOREAI_QUIET;
    } else {
      process.env.SITECOREAI_QUIET = originalQuiet;
    }
    if (originalJson === undefined) {
      delete process.env.SITECOREAI_JSON;
    } else {
      process.env.SITECOREAI_JSON = originalJson;
    }
  });

  it("returns null when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const { startSpinner } = await import("../../../src/shared/spinner");
    const result = await startSpinner("Working...");
    expect(result).toBeNull();
    expect(oraMocks.ora).not.toHaveBeenCalled();
  });

  it("returns null in quiet mode", async () => {
    process.env.SITECOREAI_QUIET = "1";
    const { startSpinner } = await import("../../../src/shared/spinner");
    const result = await startSpinner("Working...");
    expect(result).toBeNull();
    expect(oraMocks.ora).not.toHaveBeenCalled();
  });

  it("returns null in JSON mode", async () => {
    process.env.SITECOREAI_JSON = "1";
    const { startSpinner } = await import("../../../src/shared/spinner");
    const result = await startSpinner("Working...");
    expect(result).toBeNull();
    expect(oraMocks.ora).not.toHaveBeenCalled();
  });

  it("starts and drives the spinner handle", async () => {
    const { startSpinner } = await import("../../../src/shared/spinner");
    const handle = await startSpinner("Working...");
    expect(handle).not.toBeNull();
    expect(oraMocks.ora).toHaveBeenCalledWith({ text: "Working..." });
    handle?.succeed("Done");
    expect(oraMocks.spinner.succeed).toHaveBeenCalledWith("Done");
    const failedHandle = await startSpinner("Failed...");
    failedHandle?.fail("Oops");
    expect(oraMocks.spinner.fail).toHaveBeenCalledWith("Oops");
  });
});
