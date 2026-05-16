#!/usr/bin/env tsx
/**
 * Generate docs/commands.md from the real Commander program tree.
 *
 * `createProgram` (from `src/program.ts`) assembles the exact nested
 * command structure the CLI runs — the `setup` / `hygiene` / `content`
 * / `ops` / `provision` / `cli` parent groups and everything under
 * them. `src/program.ts` is deliberately side-effect-free, so importing
 * it here does NOT boot the CLI. The doc walker recurses the whole tree,
 * so command paths render fully qualified (`scai setup login`, not
 * `scai login`).
 *
 * Run via `pnpm docs:commands`.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command, Option } from "commander";

import { createProgram } from "../src/program";
import packageJson from "../package.json";

/**
 * Build the documented program tree. `createProgram` needs a `runCli`
 * callback for the interactive `cli shell` command; doc generation never
 * runs it, so a no-op stub is supplied. The shell command is filtered
 * out of the rendered output below regardless.
 */
const buildProgram = (): Command => createProgram(async () => undefined);

const escapePipe = (value: string): string => value.replace(/\|/g, "\\|");

const isMachineSpecific = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("~");
};

const renderOption = (option: Option): string => {
  const flags = `\`${option.flags}\``;
  const description = option.description || "";
  const showDefault = option.defaultValue !== undefined && !isMachineSpecific(option.defaultValue);
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
    `Generated from the Commander tree assembled by \`createProgram\` in \`src/program.ts\` at scai v${packageJson.version}.`
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

  const output =
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n";
  const outputPath = resolve(__dirname, "..", "docs", "commands.md");
  writeFileSync(outputPath, output);
  process.stdout.write(`Wrote ${outputPath}\n`);
};

main();
