import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { consola } from "consola";
import { createTelemetryCommand } from "../../../src/commands/telemetry";

const writeConfig = async (dir: string, settings: Record<string, unknown>): Promise<void> => {
  await fs.writeFile(
    path.join(dir, "sitecoreai.cli.json"),
    JSON.stringify({ modules: ["./module.module.json"], settings }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(dir, "module.module.json"), "{}", "utf8");
};

const readSettings = async (dir: string): Promise<Record<string, unknown>> => {
  const raw = JSON.parse(await fs.readFile(path.join(dir, "sitecoreai.cli.json"), "utf8"));
  return raw.settings ?? {};
};

describe("telemetry command", () => {
  it("prints telemetry status as json", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.env.SITECOREAI_TELEMETRY = "1";

    const command = createTelemetryCommand();
    await command.parseAsync(["node", "scai", "status", "--json"]);

    expect(stdoutSpy).toHaveBeenCalled();
    delete process.env.SITECOREAI_TELEMETRY;
    stdoutSpy.mockRestore();
  });

  it("prints telemetry status as text", async () => {
    const infoSpy = vi.spyOn(consola, "info").mockImplementation(() => undefined);
    process.env.SITECOREAI_TELEMETRY = "0";

    const command = createTelemetryCommand();
    await command.parseAsync(["node", "scai", "status"]);

    expect(infoSpy).toHaveBeenCalled();
    delete process.env.SITECOREAI_TELEMETRY;
    infoSpy.mockRestore();
  });

  it("disables telemetry by writing settings.telemetryEnabled", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-cmd-"));
    await writeConfig(dir, {});

    const command = createTelemetryCommand();
    await command.parseAsync(["node", "scai", "disable", "--config", dir, "--json"]);

    expect((await readSettings(dir)).telemetryEnabled).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("re-enables telemetry by writing settings.telemetryEnabled", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-telemetry-cmd-"));
    await writeConfig(dir, { telemetryEnabled: false });

    const command = createTelemetryCommand();
    await command.parseAsync(["node", "scai", "enable", "--config", dir, "--json"]);

    expect((await readSettings(dir)).telemetryEnabled).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
