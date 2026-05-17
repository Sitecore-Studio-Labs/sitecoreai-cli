import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

/**
 * `installMcpStdoutDiscipline` / `writeStartupLine` — the stdout-discipline
 * guard for `scai mcp serve`. The module carries a one-shot `installed`
 * flag and mutates global state (`process.env`, consola reporters), so
 * each test re-imports a fresh copy via `vi.resetModules()` and the
 * suite snapshots + restores the env keys and consola reporter set.
 *
 * `consola` is a process-wide singleton (same instance across module
 * graphs), so `installMcpStdoutDiscipline`'s `consola.setReporters(...)`
 * affects the top-level `consola` imported here too.
 */

const ENV_KEYS = [
  "SITECOREAI_MCP_SERVE",
  "SITECOREAI_JSON",
  "SITECOREAI_QUIET",
  "SITECOREAI_NON_INTERACTIVE",
  "SITECOREAI_TELEMETRY",
] as const;

const importLogging = async (): Promise<typeof import("../../../src/mcp/logging")> => {
  vi.resetModules();
  return import("../../../src/mcp/logging");
};

/** Invoke the discipline reporter directly with a synthetic log object. */
const emit = (message: unknown, args: unknown[] = []): void => {
  const reporter = consola.options.reporters.at(-1);
  reporter?.log({ message, args, type: "log", level: 1, tag: "", date: new Date() } as never, {
    options: consola.options,
  });
};

let envSnapshot: Record<string, string | undefined>;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  envSnapshot = {};
  for (const key of ENV_KEYS) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (envSnapshot[key] === undefined) delete process.env[key];
    else process.env[key] = envSnapshot[key];
  }
  stderr.mockRestore();
  // Restore consola to a default reporter so other suites are unaffected.
  consola.setReporters([]);
});

describe("installMcpStdoutDiscipline — env flags", () => {
  it("sets the four discipline flags to '1'", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    expect(process.env.SITECOREAI_MCP_SERVE).toBe("1");
    expect(process.env.SITECOREAI_JSON).toBe("1");
    expect(process.env.SITECOREAI_QUIET).toBe("1");
    expect(process.env.SITECOREAI_NON_INTERACTIVE).toBe("1");
  });

  it("sets SITECOREAI_TELEMETRY=false when telemetry is explicitly disabled", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline({ telemetry: false });
    expect(process.env.SITECOREAI_TELEMETRY).toBe("false");
  });

  it("leaves SITECOREAI_TELEMETRY untouched when telemetry is enabled", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline({ telemetry: true });
    expect(process.env.SITECOREAI_TELEMETRY).toBeUndefined();
  });

  it("leaves SITECOREAI_TELEMETRY untouched when no options are passed", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    expect(process.env.SITECOREAI_TELEMETRY).toBeUndefined();
  });

  it("is idempotent — a second call after a flag is cleared does not re-apply", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    delete process.env.SITECOREAI_JSON;
    installMcpStdoutDiscipline();
    // The one-shot `installed` guard short-circuits the second call.
    expect(process.env.SITECOREAI_JSON).toBeUndefined();
  });
});

describe("installMcpStdoutDiscipline — consola reporter routes to stderr", () => {
  it("installs exactly one reporter", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    expect(consola.options.reporters).toHaveLength(1);
  });

  it("pipes a plain log message to stderr with a trailing newline", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    emit("hello from a tool");
    expect(stderr).toHaveBeenCalledWith("hello from a tool\n");
  });

  it("joins message + string args with a space", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    emit("status", ["ok"]);
    expect(stderr).toHaveBeenCalledWith("status ok\n");
  });

  it("JSON-stringifies a non-string arg", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    emit("payload", [{ count: 2 }]);
    expect(stderr).toHaveBeenCalledWith('payload {"count":2}\n');
  });

  it("falls back to String() for an unstringifiable arg (circular ref)", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    emit("loop", [circular]);
    expect(stderr).toHaveBeenCalledWith("loop [object Object]\n");
  });

  it("emits a message-only line when there are no args", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    emit("solo", []);
    expect(stderr).toHaveBeenCalledWith("solo\n");
  });

  it("does not write when the log line is empty", async () => {
    const { installMcpStdoutDiscipline } = await importLogging();
    installMcpStdoutDiscipline();
    stderr.mockClear();
    emit(undefined, []);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("writeStartupLine", () => {
  it("writes the message to stderr with a trailing newline", async () => {
    const { writeStartupLine } = await importLogging();
    writeStartupLine("scai mcp serve ready");
    expect(stderr).toHaveBeenCalledWith("scai mcp serve ready\n");
  });
});
