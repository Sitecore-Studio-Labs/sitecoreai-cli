import { Command, Option } from "commander";
import { runBriefCommentAdd, runBriefCommentsList } from "@/brief/tasks";
import {
  addApplyOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

const createCommentsListCommand = (): Command => {
  const command = new Command("list")
    .description("List comments across briefs, or filter to one brief with [briefId].")
    .argument("[briefId]", "Brief UUID to filter comments to. Omit for tenant-wide listing.");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--limit <n>", "Page size").argParser((v) => Number(v)));
  command.action(async (briefId: string | undefined, options) => {
    await runBriefCommentsList({ ...options, briefId });
  });
  return command;
};

const createCommentsAddCommand = (): Command => {
  const command = new Command("add")
    .description(
      "Post a comment to a brief. UNVERIFIED — the comment write body is a best guess; smoke-test before relying on it. Requires --apply."
    )
    .argument("<briefId>", "Brief UUID")
    .addOption(new Option("--text <text>", "Comment text").makeOptionMandatory(true));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (briefId, options) => {
    await withApplyGate(async (opts: { text: string; apply?: boolean; whatIf?: boolean }) => {
      await runBriefCommentAdd({ ...opts, briefId });
    })(options);
  });
  return command;
};

/**
 * `scai ops brief comments …` — list or post comments on Sitecore
 * Content Operations briefs.
 *
 *   - list [briefId]        — list comments (tenant-wide or per-brief)
 *   - add <briefId> --text  — post a comment (UNVERIFIED write body)
 *
 * With no subcommand, `comments` lists — matching the pre-`add` behaviour.
 */
export const createBriefCommentsCommand = (): Command => {
  const command = new Command("comments").description("Brief comment operations (list, add).");
  command.addCommand(createCommentsListCommand(), { isDefault: true });
  command.addCommand(createCommentsAddCommand());
  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops brief comments list <briefId> -n agents\n" +
      '  $ scai ops brief comments add <briefId> --text "Looks good" -n agents --apply\n'
  );
  return command;
};
