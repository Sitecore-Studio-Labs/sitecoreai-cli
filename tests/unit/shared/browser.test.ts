import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
type Platform = typeof process.platform;

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const setPlatform = (value: Platform): void => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

describe("openBrowser", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.mocked(spawn).mockReset();
  });

  it("returns true when spawn succeeds", async () => {
    const { openBrowser } = await import("../../../src/shared/browser");
    expect(openBrowser("https://example.com")).toBe(true);
    expect(spawn).toHaveBeenCalled();
  });

  it("uses the macOS open command", async () => {
    setPlatform("darwin");
    const { openBrowser } = await import("../../../src/shared/browser");
    openBrowser("https://example.com");
    expect(spawn).toHaveBeenCalledWith(
      "open",
      ["https://example.com"],
      expect.objectContaining({ shell: false })
    );
  });

  it("uses the Windows start command", async () => {
    setPlatform("win32");
    const { openBrowser } = await import("../../../src/shared/browser");
    openBrowser("https://example.com");
    expect(spawn).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "https://example.com"],
      expect.objectContaining({ shell: true })
    );
  });

  it("returns false when spawn throws", async () => {
    setPlatform("linux");
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });
    const { openBrowser } = await import("../../../src/shared/browser");
    expect(openBrowser("https://example.com")).toBe(false);
  });
});
