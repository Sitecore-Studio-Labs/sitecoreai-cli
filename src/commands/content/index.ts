import { Command } from "commander";
import { createContentVersionCommand } from "./version";

export const createContentCommand = (): Command => {
  const command = new Command("content").description(
    "Content-state controls. Mutates CM-side fields that affect what `scai publish` picks up — `__Never publish`, `__Valid from`, `__Valid to`, and per-version inspection. Live separate from `scai publish` because these are content mutations, not publish operations."
  );

  command.addCommand(createContentVersionCommand());
  return command;
};
