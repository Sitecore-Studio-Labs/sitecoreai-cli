import { describe, expect, it } from "vitest";
import { createSerializationCommand } from "../../../src/commands/serialization";

const getCommand = (root: ReturnType<typeof createSerializationCommand>, path: string[]) => {
  let current = root;
  for (const segment of path) {
    const next = current.commands.find((cmd) => cmd.name() === segment);
    if (!next) {
      throw new Error(`Command not found: ${path.join(" ")}`);
    }
    current = next;
  }
  return current;
};

const getOptionLongs = (cmd: ReturnType<typeof createSerializationCommand>): string[] =>
  cmd.options.map((opt) => opt.long).filter((value): value is string => Boolean(value));

const expectOptions = (cmd: ReturnType<typeof createSerializationCommand>, expected: string[]) => {
  const actual = [...new Set(getOptionLongs(cmd))].sort();
  const sortedExpected = [...new Set(expected)].sort();
  expect(actual).toEqual(sortedExpected);
};

const baseOptions = [
  "--config",
  "--verbose",
  "--trace",
  "--quiet",
  "--json",
  "--log-file",
  "--non-interactive",
];
const includeExclude = ["--include", "--exclude"];
const environment = ["--environment-name"];

describe("serialization commands", () => {
  const serialization = createSerializationCommand();

  it("info options", () => {
    const cmd = getCommand(serialization, ["info"]);
    expectOptions(cmd, [...includeExclude, ...baseOptions]);
  });

  it("explain options", () => {
    const cmd = getCommand(serialization, ["explain"]);
    expectOptions(cmd, ["--path", "--database", ...baseOptions]);
  });

  it("pull options", () => {
    const cmd = getCommand(serialization, ["pull"]);
    expectOptions(cmd, [...environment, ...includeExclude, "--what-if", "--force", ...baseOptions]);
  });

  it("push options", () => {
    const cmd = getCommand(serialization, ["push"]);
    expectOptions(cmd, [
      ...environment,
      ...includeExclude,
      "--what-if",
      "--force",
      "--allow-write",
      ...baseOptions,
    ]);
  });

  it("diff options", () => {
    const cmd = getCommand(serialization, ["diff"]);
    expectOptions(cmd, [
      "--source",
      "--destination",
      "--path",
      "--source-database",
      "--destination-database",
      "--push",
      ...includeExclude,
      ...baseOptions,
    ]);
  });

  it("validate options", () => {
    const cmd = getCommand(serialization, ["validate"]);
    expectOptions(cmd, [...includeExclude, "--fix", ...baseOptions]);
  });

  it("watch options", () => {
    const cmd = getCommand(serialization, ["watch"]);
    expectOptions(cmd, [...environment, ...includeExclude, ...baseOptions]);
  });

  it("package create options", () => {
    const cmd = getCommand(serialization, ["package", "create"]);
    expectOptions(cmd, ["--output", "--overwrite", ...includeExclude, ...baseOptions]);
  });

  it("package install options", () => {
    const cmd = getCommand(serialization, ["package", "install"]);
    expectOptions(cmd, [
      "--package",
      "--auth",
      "--cm",
      "--client-id",
      "--client-secret",
      ...environment,
      "--what-if",
      ...includeExclude,
      "--publish",
      "--pt",
      ...baseOptions,
    ]);
  });
});
