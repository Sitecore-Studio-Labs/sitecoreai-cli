import { Command } from "commander";
import { buildScaiEnvelope } from "@/shared/envelope";
import { toLogger } from "@/shared/cli-tasks";
import type { Logger } from "@/shared/logger";
import { TOPICS, type Topic } from "@/shared/topics";
import { addVerbosityOptions } from "../shared";

/**
 * `scai cli topics` — intent-based command index.
 *
 * `topics` groups commands by what the operator is trying to do — "why
 * won't this delete?", "clean up after a site removal", "manage known
 * debt" — rather than where they live in the (alphabetical) `--help`
 * tree. This file is the CLI renderer; the curated topic data lives in
 * `@/shared/topics` so the MCP `scai://help/topics` resource serves the
 * exact same index.
 */

const printTopicList = (logger: Logger): void => {
  if (logger.isJson()) {
    logger.json(
      buildScaiEnvelope({
        command: "topics.list",
        environment: null,
        data: TOPICS.map((t) => ({ name: t.name, description: t.description })),
      })
    );
    return;
  }
  logger.info("scai cli topics — intent-based command index", "cyan");
  logger.info("");
  for (const t of TOPICS) {
    logger.info(`  ${t.name}`, "yellow");
    logger.info(`    ${t.description}`, "gray");
  }
  logger.info("");
  logger.info("Show one topic's commands: `scai cli topics show <name>`", "gray");
};

const printSingleTopic = (logger: Logger, topic: Topic): void => {
  if (logger.isJson()) {
    logger.json(
      buildScaiEnvelope({
        command: "topics.show",
        environment: null,
        data: topic,
      })
    );
    return;
  }
  logger.info(`scai cli topics: ${topic.name}`, "cyan");
  logger.info(`  ${topic.description}`, "gray");
  logger.info("");
  for (const c of topic.commands) {
    logger.info(`  ${c.command}`, "yellow");
    logger.info(`    ${c.description}`, "gray");
    logger.info("");
  }
};

export const createTopicsCommand = (): Command => {
  const command = new Command("topics").description(
    "Show scai commands grouped by intent (e.g. 'diagnose-blocked-delete') instead of alphabetically"
  );

  const list = new Command("list").description("List every topic with its one-line summary.");
  addVerbosityOptions(list);
  list.action((options) => {
    printTopicList(toLogger(options));
  });

  const show = new Command("show")
    .description("Expand one topic into its recommended-run command sequence.")
    .argument("<name>", "Topic slug to expand — see `scai cli topics list`.");
  addVerbosityOptions(show);
  show.action((name: string, options) => {
    const logger = toLogger(options);
    const topic = TOPICS.find((t) => t.name === name);
    if (!topic) {
      logger.warn(
        `Unknown topic '${name}'. Run \`scai cli topics list\` to see the available topics.`
      );
      process.exitCode = 1;
      return;
    }
    printSingleTopic(logger, topic);
  });

  command.addCommand(list);
  command.addCommand(show);

  // Bare `scai cli topics` defaults to the index — the most common need.
  addVerbosityOptions(command);
  command.action((options) => {
    printTopicList(toLogger(options));
  });

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai cli topics list             # every topic + summary\n" +
      "  $ scai cli topics show diagnose-blocked-delete\n" +
      "  $ scai cli topics                  # same as `topics list`\n" +
      "\nThe topic groupings are curated — they reflect workflows\n" +
      '("why won\'t this delete?"), not the audit/cleanup directory layout.\n' +
      "Use this when you're not sure which command to reach for; the\n" +
      "groupings save you from grepping `--help` or reinventing a primitive\n" +
      "that already exists.\n"
  );
  return command;
};

/** Exported for unit tests — pin the topic list shape. */
export const __topicsForTest = TOPICS;
