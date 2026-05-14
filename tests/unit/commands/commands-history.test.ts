import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { consola } from "consola";
import { createHistoryCommand } from "../../../src/commands/history";

describe("history command", () => {
  it("prints the history path as json", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(tmpDir, "history.log");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const command = createHistoryCommand();
    await command.parseAsync([
      "node",
      "scai",
      "history",
      "--show-path",
      "--json",
      "--path",
      historyPath,
    ]);

    expect(stdoutSpy).toHaveBeenCalled();
    stdoutSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prints the history path as text", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(tmpDir, "history.log");
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);

    const command = createHistoryCommand();
    await command.parseAsync(["node", "scai", "history", "--show-path", "--path", historyPath]);

    expect(infoSpy).toHaveBeenCalledWith(historyPath);
    infoSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prints raw history lines and supports reverse", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(tmpDir, "history.log");
    await fs.writeFile(
      historyPath,
      `{"timestamp":"1","event":"start","command":"scai status"}\nnot-json\n`,
      "utf8"
    );
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);

    const command = createHistoryCommand();
    await command.parseAsync([
      "node",
      "scai",
      "history",
      "--raw",
      "--reverse",
      "--limit",
      "1",
      "--path",
      historyPath,
    ]);

    expect(infoSpy).toHaveBeenCalled();
    infoSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("formats parsed history entries when not raw", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(tmpDir, "history.log");
    await fs.writeFile(
      historyPath,
      `{"timestamp":"1","event":"start","command":"scai status","error":"boom"}\nnot-json\n`,
      "utf8"
    );
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);

    const command = createHistoryCommand();
    await command.parseAsync(["node", "scai", "history", "--path", historyPath]);

    expect(infoSpy).toHaveBeenCalledWith("1 [start] scai status - boom");
    expect(infoSpy).toHaveBeenCalledWith("not-json");
    infoSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits JSON output for parsed history", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(tmpDir, "history.log");
    await fs.writeFile(
      historyPath,
      `{"timestamp":"1","event":"start","command":"scai status"}\nnot-json\n`,
      "utf8"
    );
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const command = createHistoryCommand();
    await command.parseAsync([
      "node",
      "scai",
      "history",
      "--json",
      "--limit",
      "0",
      "--path",
      historyPath,
    ]);

    const payload = stdoutSpy.mock.calls[0]?.[0];
    const parsed = typeof payload === "string" ? JSON.parse(payload) : [];
    expect(parsed).toEqual([
      { timestamp: "1", event: "start", command: "scai status" },
      { raw: "not-json" },
    ]);
    stdoutSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("warns when history file is missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-history-"));
    const historyPath = path.join(tmpDir, "missing.log");
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);

    const command = createHistoryCommand();
    await command.parseAsync(["node", "scai", "history", "--path", historyPath]);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
