import { Command } from "commander";
import { createExplainWhyBlockedCommand } from "./why-blocked";

/**
 * `scai explain` — read-only verbs that compose existing primitives
 * into focused answers to specific operator questions. Today the
 * group has one verb (`why-blocked`); the home for future
 * "explain X" commands (e.g. `explain dead-template`, `explain
 * orphan-site`) that combine multiple audits into a single answer.
 */
export const createExplainCommand = (): Command => {
  const command = new Command("explain").description(
    "Compose multiple audits to answer specific operator questions"
  );
  command.addCommand(createExplainWhyBlockedCommand());
  return command;
};
