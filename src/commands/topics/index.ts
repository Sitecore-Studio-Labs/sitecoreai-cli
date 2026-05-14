import { Command } from "commander";
import { buildScaiEnvelope } from "@/shared/envelope";
import { toLogger } from "@/shared/cli-tasks";
import type { Logger } from "@/shared/logger";
import { addVerbosityOptions } from "../shared";

/**
 * `scai topics` — intent-based command index.
 *
 * The audit list is alphabetical with one-line summaries; agents and
 * operators reinventing existing commands because they didn't know
 * what to grep for is the discoverability bug this verb addresses.
 * `topics` groups commands by what the operator is trying to do —
 * "why won't this delete?", "clean up after a site removal", "manage
 * known debt" — rather than where they live in the command tree.
 *
 * Data lives inline here on purpose: the topic list is a curated,
 * hand-edited document, not an auto-generated index. The cost is
 * keeping this file in sync when commands move; the payoff is that
 * the topic groupings reflect *workflows*, not the directory layout.
 */

interface TopicCommand {
  command: string;
  description: string;
}

interface Topic {
  /** Short slug for `scai topics <name>`. */
  name: string;
  /** One-line description shown in the index. */
  description: string;
  /** Commands grouped under the topic, in recommended-run order. */
  commands: TopicCommand[];
}

const TOPICS: Topic[] = [
  {
    name: "diagnose-blocked-delete",
    description: "Find out why a Sitecore item won't delete — what references hold it.",
    commands: [
      {
        command: "scai explain why-blocked <itemId>",
        description:
          "One-shot: run audit references + audit template-dependencies and merge the findings, sorted by kind",
      },
      {
        command: "scai audit references --to <itemId>",
        description:
          "Walk content fields for items whose value mentions the target (slow but broad)",
      },
      {
        command: "scai audit template-dependencies --template-id <itemId>",
        description:
          "Index-driven check for the five structural reference shapes (base-template, insert-options, …)",
      },
    ],
  },
  {
    name: "clean-orphan-content",
    description:
      "Delete the residue left after a Sites-API site delete or a subtree-removal mistake.",
    commands: [
      {
        command: "scai audit site-residue list",
        description:
          "Find orphan tenant/site folders in /sitecore/templates, /layout, /media library",
      },
      {
        command: "scai cleanup site-residue purge --apply",
        description: "Delete the orphans flagged by the audit; honors a pre-flight ref scan",
      },
      {
        command: "scai cleanup subtree delete --path <root> --apply",
        description:
          "Bottom-up cascade delete of a subtree; hard-blocks on external inbound references",
      },
    ],
  },
  {
    name: "manage-known-debt",
    description:
      "Accept known-good findings into a per-env baseline so CI only flags new regressions.",
    commands: [
      {
        command: "scai audit X list",
        description: "Every audit shows the baseline count under its headline (since 2026-05-14)",
      },
      {
        command: "scai audit X list --baseline",
        description: "Filter out findings already in the baseline (CI / drift mode)",
      },
      {
        command: "scai audit X list --json | scai audit baseline accept --audit X",
        description: "Pipe an audit envelope into the baseline (idempotent)",
      },
      {
        command: "scai audit baseline show / remove / reset",
        description: "Inspect and edit the baseline file (.scai/audit-baseline-<env>.json)",
      },
    ],
  },
  {
    name: "deduplicate-content",
    description: "Find and merge items with identical content hashes.",
    commands: [
      {
        command: "scai audit duplicates list",
        description: "Group items by content hash (excluding system fields by default)",
      },
      {
        command:
          "scai audit duplicates list --json | scai cleanup duplicates purge --from-stdin --apply",
        description:
          "Pipeline: skip the cleanup's internal audit re-run by piping the audit's findings in",
      },
      {
        command: "scai cleanup duplicates purge --apply",
        description:
          "Pick a survivor per group (--keep-rule) and delete the rest; pre-flight ref scan blocks unsafe deletes",
      },
    ],
  },
  {
    name: "pipeline-audit-cleanup",
    description:
      "Compose an audit + its cleanup in one shell pipeline to avoid running the same scan twice.",
    commands: [
      {
        command: "scai audit X list --json | scai cleanup X --from-stdin --apply",
        description:
          "Cleanup reads findings from stdin instead of re-running the audit; supported on duplicates today, more cleanups in follow-ups",
      },
      {
        command: "scai audit X list --json | scai audit baseline accept --audit X",
        description: "Pipe an audit envelope into the baseline (same shape — composes naturally)",
      },
    ],
  },
  {
    name: "automate-with-agents",
    description: "Run scai from an MCP-compatible agent host (Claude Code, Cursor, Windsurf, …).",
    commands: [
      {
        command: "scai mcp serve",
        description:
          "Launch the stdio MCP server bound to a single environment; defers keychain access to first tool call",
      },
      {
        command: "scai mcp tools list / schema",
        description: "Offline inspector for the 24+ workflow-shaped tools the server exposes",
      },
    ],
  },
];

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
  logger.info("scai topics — intent-based command index", "cyan");
  logger.info("");
  for (const t of TOPICS) {
    logger.info(`  ${t.name}`, "yellow");
    logger.info(`    ${t.description}`, "gray");
  }
  logger.info("");
  logger.info("Show one topic's commands: `scai topics <name>`", "gray");
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
  logger.info(`scai topics: ${topic.name}`, "cyan");
  logger.info(`  ${topic.description}`, "gray");
  logger.info("");
  for (const c of topic.commands) {
    logger.info(`  ${c.command}`, "yellow");
    logger.info(`    ${c.description}`, "gray");
    logger.info("");
  }
};

export const createTopicsCommand = (): Command => {
  const command = new Command("topics")
    .description(
      "Show scai commands grouped by intent (e.g. 'diagnose-blocked-delete') instead of alphabetically"
    )
    .argument("[name]", "Topic slug to expand. Omit to list every topic.");
  addVerbosityOptions(command);
  command.action((name: string | undefined, options) => {
    const logger = toLogger(options);
    if (!name) {
      printTopicList(logger);
      return;
    }
    const topic = TOPICS.find((t) => t.name === name);
    if (!topic) {
      logger.warn(
        `Unknown topic '${name}'. Run \`scai topics\` (no argument) to see the available topics.`
      );
      process.exitCode = 1;
      return;
    }
    printSingleTopic(logger, topic);
  });
  command.addHelpText(
    "after",
    "\nThe topic groupings are curated — `scai topics` reflects workflows\n" +
      '("why won\'t this delete?"), not the audit/cleanup directory layout.\n' +
      "Use this when you're not sure which command to reach for; the\n" +
      "groupings save you from grepping `--help` or reinventing a primitive\n" +
      "that already exists.\n"
  );
  return command;
};

/** Exported for unit tests — pin the topic list shape. */
export const __topicsForTest = TOPICS;
