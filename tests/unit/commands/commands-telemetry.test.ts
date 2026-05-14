import { describe, expect, it, vi } from "vitest";
import { consola } from "consola";
import { createTelemetryCommand } from "../../../src/commands/telemetry";

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
});
