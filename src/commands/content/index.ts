import { Command } from "commander";
import { createContentMoveCommand } from "./move";
import { createContentVersionCommand } from "./version";

export const createContentCommand = (): Command => {
  const command = new Command("content").description(
    "Content-state controls. Mutates CM-side fields that affect what `scai content publish` picks up — `__Never publish`, `__Valid from`, `__Valid to`, and per-version inspection. Also relocates items (`move`) without breaking inbound references."
  );

  command.addCommand(createContentMoveCommand());
  command.addCommand(createContentVersionCommand());
  return command;
};
