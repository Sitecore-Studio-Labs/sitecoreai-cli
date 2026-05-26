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
      ["https://example.com/"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
    );
  });

  it("uses rundll32 FileProtocolHandler on Windows", async () => {
    setPlatform("win32");
    const { openBrowser } = await import("../../../src/shared/browser");
    openBrowser("https://example.com");
    expect(spawn).toHaveBeenCalledWith(
      "rundll32",
      ["url.dll,FileProtocolHandler", "https://example.com/"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
    );
  });

  it("rejects non-http(s) URLs without launching anything", async () => {
    setPlatform("linux");
    const { openBrowser } = await import("../../../src/shared/browser");
    expect(openBrowser("file:///etc/passwd")).toBe(false);
    expect(openBrowser("javascript:alert(1)")).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
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
