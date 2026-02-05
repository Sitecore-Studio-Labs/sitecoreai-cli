import { describe, expect, it } from "vitest";
import { createLoginCommand } from "../../../src/commands/login";
import { createHistoryCommand } from "../../../src/commands/history";
import { createInitCommand } from "../../../src/commands/init";
import { createStatusCommand } from "../../../src/commands/status";
import { createLogoutCommand } from "../../../src/commands/logout";
import { createConfigCommand } from "../../../src/commands/config";
import { createTelemetryCommand } from "../../../src/commands/telemetry";

const getOptionLongs = (cmd: { options: Array<{ long?: string | undefined }> }): string[] =>
  cmd.options.map((opt) => opt.long).filter((value): value is string => Boolean(value));

const expectOptions = (
  cmd: { options: Array<{ long?: string | undefined }> },
  expected: string[]
) => {
  const actual = [...new Set(getOptionLongs(cmd))].sort();
  const sortedExpected = [...new Set(expected)].sort();
  expect(actual).toEqual(sortedExpected);
};

describe("top-level commands", () => {
  it("logout options", () => {
    const cmd = createLogoutCommand();
    expectOptions(cmd, [
      "--environment-name",
      "--config",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
      "--all",
    ]);
  });

  it("status options", () => {
    const cmd = createStatusCommand();
    expectOptions(cmd, [
      "--config",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
    ]);
  });

  it("login options", () => {
    const cmd = createLoginCommand();
    expectOptions(cmd, [
      "--environment-name",
      "--config",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
      "--client-id",
      "--client-secret",
      "--use-client-credentials",
      "--print",
    ]);
  });

  it("history options", () => {
    const cmd = createHistoryCommand();
    expectOptions(cmd, [
      "--path",
      "--limit",
      "--raw",
      "--reverse",
      "--show-path",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
    ]);
  });

  it("init options", () => {
    const cmd = createInitCommand();
    expectOptions(cmd, [
      "--environment-name",
      "--config",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
      "--host",
      "--ref",
      "--allow-write",
      "--organization-id",
      "--tenant-id",
      "--organization",
      "--project",
      "--environment",
      "--wizard",
      "--deploy-token",
      "--client-id",
      "--client-secret",
      "--use-client-credentials",
      "--set-default",
    ]);
  });

  it("config validate options", () => {
    const cmd = createConfigCommand();
    const validate = cmd.commands.find((entry) => entry.name() === "validate");
    if (!validate) {
      throw new Error("config validate command missing");
    }
    expectOptions(validate, [
      "--config",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
    ]);
  });

  it("telemetry status options", () => {
    const cmd = createTelemetryCommand();
    const status = cmd.commands.find((entry) => entry.name() === "status");
    if (!status) {
      throw new Error("telemetry status command missing");
    }
    expectOptions(status, [
      "--config",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
    ]);
  });
});
