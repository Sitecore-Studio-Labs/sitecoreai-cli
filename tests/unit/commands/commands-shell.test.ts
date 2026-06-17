import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShellCommand } from "../../../src/commands/shell";

const readlineMocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  type MockInterface = {
    rl: {
      prompt: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      resume: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      on: (event: string, handler: Handler) => MockInterface["rl"];
    };
    emitLine: (line: string) => void;
    emitSigint: () => void;
  };

  const createMockInterface = (): MockInterface => {
    const handlers: Record<string, Handler[]> = {};
    const emit = (event: string, ...args: unknown[]) => {
      (handlers[event] ?? []).forEach((handler) => handler(...args));
    };
    const rl = {
      prompt: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      write: vi.fn(),
      close: vi.fn(() => emit("close")),
      on: (event: string, handler: Handler) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(handler);
        return rl;
      },
    };
    return {
      rl,
      emitLine: (line: string) => emit("line", line),
      emitSigint: () => emit("SIGINT"),
    };
  };

  let current: MockInterface | null = null;
  const createInterface = vi.fn(() => {
    current = createMockInterface();
    return current.rl;
  });

  return {
    createInterface,
    getCurrent: (): MockInterface | null => current,
  };
});

vi.mock("node:readline", () => ({
  default: {
    createInterface: (...args: unknown[]) => readlineMocks.createInterface(...args),
  },
}));

describe("shell command", () => {
  const originalEnv = { ...process.env };
  const originalIn = process.stdin.isTTY;
  const originalOut = process.stdout.isTTY;

  const setTty = (value: boolean): void => {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setTty(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    vi.clearAllMocks();
  });

  it("runs shell input as commands", async () => {
    process.env.SITECOREAI_JSON = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    expect(current).not.toBeNull();
    current?.emitLine("scai setup status");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runCli).toHaveBeenCalledTimes(1);
    current?.emitLine("exit");
    await parsePromise;

    const [argv, options] = runCli.mock.calls[0];
    expect(argv).toEqual(["node", "scai", "setup", "status"]);
    expect(options).toEqual(
      expect.objectContaining({
        skipBanner: true,
        shellMode: true,
        baseEnv: expect.objectContaining({ SITECOREAI_JSON: "1" }),
      })
    );
    logSpy.mockRestore();
  });

  it("does not re-enter shell", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    expect(current).not.toBeNull();
    current?.emitLine("shell");
    current?.emitLine("quit");
    await parsePromise;

    expect(runCli).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Already in shell. Type 'exit' to leave.");
    logSpy.mockRestore();
  });

  it("strips a leading `scai` token before dispatching", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    current?.emitLine("scai setup status");
    await new Promise((resolve) => setTimeout(resolve, 0));
    current?.emitLine("exit");
    await parsePromise;

    expect(runCli.mock.calls[0][0]).toEqual(["node", "scai", "setup", "status"]);
    logSpy.mockRestore();
  });

  it("strips a leading `sitecoreai-cli` token before dispatching", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    current?.emitLine("sitecoreai-cli deploy projects list");
    await new Promise((resolve) => setTimeout(resolve, 0));
    current?.emitLine("exit");
    await parsePromise;

    expect(runCli.mock.calls[0][0]).toEqual(["node", "scai", "deploy", "projects", "list"]);
    logSpy.mockRestore();
  });

  it("honors single- and double-quoted arguments when splitting input", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    current?.emitLine("init --environment-name \"demo env\" --note 'a b'");
    await new Promise((resolve) => setTimeout(resolve, 0));
    current?.emitLine("exit");
    await parsePromise;

    expect(runCli.mock.calls[0][0]).toEqual([
      "node",
      "scai",
      "init",
      "--environment-name",
      "demo env",
      "--note",
      "a b",
    ]);
    logSpy.mockRestore();
  });

  it("ignores a blank line without invoking the CLI", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    current?.emitLine("   ");
    await new Promise((resolve) => setTimeout(resolve, 0));
    current?.emitLine("exit");
    await parsePromise;

    expect(runCli).not.toHaveBeenCalled();
    expect(current?.rl.prompt).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("prints help on `help` and `?` without invoking the CLI", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    current?.emitLine("help");
    current?.emitLine("?");
    await new Promise((resolve) => setTimeout(resolve, 0));
    current?.emitLine("exit");
    await parsePromise;

    expect(runCli).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Interactive shell commands:");
    logSpy.mockRestore();
  });

  it("closes the shell on SIGINT and prints the close notice", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);
    const parsePromise = command.parseAsync(["node", "scai"]);

    const current = readlineMocks.getCurrent();
    current?.emitSigint();
    await parsePromise;

    expect(current?.rl.write).toHaveBeenCalledWith("\n");
    expect(current?.rl.close).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Shell closed.");
    logSpy.mockRestore();
  });

  it("requires a TTY to start the shell", async () => {
    setTty(false);
    process.env.SITECOREAI_NON_INTERACTIVE = "1";
    const runCli = vi.fn().mockResolvedValue(undefined);
    const command = createShellCommand(runCli);

    await expect(command.parseAsync(["node", "scai"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});
