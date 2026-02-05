import { describe, expect, it, vi } from "vitest";

vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: () => ({
      question: vi.fn().mockResolvedValue(""),
      close: vi.fn(),
    }),
  },
}));

describe("prompt helpers", () => {
  type StdinWithRawMode = typeof process.stdin & { setRawMode?: (value: boolean) => void };

  it("returns defaults when empty", async () => {
    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const prompt = await import("../../../src/shared/prompt");
    const text = await prompt.promptText("Name", "default");
    expect(text).toBe("default");
    const confirmed = await prompt.promptConfirm("Continue?", true);
    expect(confirmed).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
  });

  it("throws when not running in a TTY", async () => {
    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    const prompt = await import("../../../src/shared/prompt");
    await expect(prompt.promptText("Name")).rejects.toThrow("Interactive prompts require a TTY");

    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
  });

  it("captures secret input and supports backspace", async () => {
    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    const originalWrite = process.stdout.write;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    (process.stdin as StdinWithRawMode).setRawMode = vi.fn();
    process.stdout.write = vi.fn() as unknown as typeof process.stdout.write;

    const prompt = await import("../../../src/shared/prompt");
    const promise = prompt.promptSecret("Secret: ");
    await Promise.resolve();
    process.stdin.emit("keypress", "a", { name: "a" });
    process.stdin.emit("keypress", "b", { name: "b" });
    process.stdin.emit("keypress", "", { name: "backspace" });
    process.stdin.emit("keypress", "", { name: "enter" });
    const value = await promise;
    expect(value).toBe("a");

    process.stdout.write = originalWrite;
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
  });

  it("rejects secret prompt on ctrl+c", async () => {
    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    const originalWrite = process.stdout.write;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    (process.stdin as StdinWithRawMode).setRawMode = vi.fn();
    process.stdout.write = vi.fn() as unknown as typeof process.stdout.write;

    const prompt = await import("../../../src/shared/prompt");
    const promise = prompt.promptSecret("Secret: ");
    await Promise.resolve();
    process.stdin.emit("keypress", "c", { name: "c", ctrl: true });
    await expect(promise).rejects.toThrow("Prompt cancelled.");

    process.stdout.write = originalWrite;
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
  });
});
