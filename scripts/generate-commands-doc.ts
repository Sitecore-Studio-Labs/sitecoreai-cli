#!/usr/bin/env tsx
/**
 * Generate docs/commands.md from the Commander program tree.
 *
 * Imports each createXCommand factory directly (rather than booting the CLI),
 * which avoids the import-time side effects in src/cli.ts and keeps this
 * script fast and pure. Add a new factory here when you add a new top-level
 * command in src/cli.ts.
 *
 * Run via `pnpm docs:commands`.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command, Option } from "commander";

import { createConfigCommand } from "../src/commands/config";
import { createDeployCommand } from "../src/commands/deploy";
import { createHistoryCommand } from "../src/commands/history";
import { createInitCommand } from "../src/commands/init";
import { createLoginCommand } from "../src/commands/login";
import { createLogoutCommand } from "../src/commands/logout";
import { createSerializationCommand } from "../src/commands/serialization";
import { createStatusCommand } from "../src/commands/status";
import { createTelemetryCommand } from "../src/commands/telemetry";

import packageJson from "../package.json";

const buildProgram = (): Command => {
  const program = new Command();
  program
    .name("scai")
    .description("SitecoreAI Deploy & Sync CLI for serialization and deploy workflows")
    .version(packageJson.version, "-V, --version", "Display the CLI version");

  // `shell` is intentionally excluded — it takes a runCli callback and is
  // an interactive REPL; documenting it inline doesn't help.
  program.addCommand(createConfigCommand());
  program.addCommand(createDeployCommand());
  program.addCommand(createHistoryCommand());
  program.addCommand(createInitCommand());
  program.addCommand(createLoginCommand());
  program.addCommand(createLogoutCommand());
  program.addCommand(createSerializationCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createTelemetryCommand());

  return program;
};

const escapePipe = (value: string): string => value.replace(/\|/g, "\\|");

const isMachineSpecific = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("~");
};

const renderOption = (option: Option): string => {
  const flags = `\`${option.flags}\``;
  const description = option.description || "";
  const showDefault =
    option.defaultValue !== undefined && !isMachineSpecific(option.defaultValue);
  const defaultValue = showDefault ? ` (default: \`${JSON.stringify(option.defaultValue)}\`)` : "";
  return `${flags} — ${escapePipe(description)}${defaultValue}`;
};

const commandPath = (command: Command): string => {
  const parts: string[] = [];
  let current: Command | null = command;
  while (current) {
    parts.unshift(current.name());
    current = current.parent ?? null;
  }
  return parts.join(" ");
};

const anchor = (command: Command): string =>
  commandPath(command).replace(/\s+/g, "-").toLowerCase();

const renderCommand = (command: Command, depth: number, lines: string[]): void => {
  if (command.hidden) {
    return;
  }
  const path = commandPath(command);
  const heading = "#".repeat(Math.min(depth + 1, 6));
  lines.push(`${heading} ${path}`);
  lines.push("");

  const description = command.description();
  if (description) {
    lines.push(description);
    lines.push("");
  }

  const aliases = command.aliases();
  if (aliases.length > 0) {
    lines.push(`**Aliases:** ${aliases.map((a) => `\`${a}\``).join(", ")}`);
    lines.push("");
  }

  const usageBase = command.usage();
  const usage = usageBase ? `${path} ${usageBase}` : path;
  lines.push("```");
  lines.push(usage);
  lines.push("```");
  lines.push("");

  const options = command.options.filter((o) => !o.hidden);
  if (options.length > 0) {
    lines.push("**Options**");
    lines.push("");
    for (const option of options) {
      lines.push(`- ${renderOption(option)}`);
    }
    lines.push("");
  }

  const subcommands = command.commands.filter((c) => !c.hidden && c.name() !== "help");
  if (subcommands.length > 0) {
    lines.push("**Subcommands**");
    lines.push("");
    for (const sub of subcommands) {
      const subPath = commandPath(sub);
      const subDescription = sub.description() || "";
      lines.push(`- [\`${subPath}\`](#${anchor(sub)}) — ${escapePipe(subDescription)}`);
    }
    lines.push("");
  }

  for (const sub of subcommands) {
    renderCommand(sub, depth + 1, lines);
  }
};

const main = (): void => {
  const program = buildProgram();
  const lines: string[] = [];

  lines.push("<!-- AUTO-GENERATED: do not edit by hand. Run `pnpm docs:commands` to refresh. -->");
  lines.push("");
  lines.push("# Command reference");
  lines.push("");
  lines.push(
    `Generated from the Commander tree in \`src/commands/\` at scai v${packageJson.version}.`
  );
  lines.push(
    "The canonical source is always `scai <command> --help`; this file is for browsing on GitHub or in IDEs."
  );
  lines.push("");
  lines.push("## scai");
  lines.push("");
  lines.push(program.description());
  lines.push("");
  lines.push("**Top-level commands**");
  lines.push("");
  const tops = program.commands.filter((c) => !c.hidden && c.name() !== "help");
  for (const top of tops) {
    lines.push(`- [\`${top.name()}\`](#${anchor(top)}) — ${escapePipe(top.description() || "")}`);
  }
  lines.push("");

  for (const top of tops) {
    renderCommand(top, 1, lines);
  }

  const output = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  const outputPath = resolve(__dirname, "..", "docs", "commands.md");
  writeFileSync(outputPath, output);
  process.stdout.write(`Wrote ${outputPath}\n`);
};

main();
