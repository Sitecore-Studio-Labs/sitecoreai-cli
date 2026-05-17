import { Command, Option } from "commander";
import { runBriefDelete } from "@/brief/tasks";
import { confirmDestructive } from "@/shared/cli-tasks";
import {
  addApplyOption,
  addConfigOption,
  addOrgScopeOptions,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

/**
 * `scai ops brief delete <briefId>` — delete a brief instance.
 *
 * Mirrors `brief types delete`: destructive, so it dry-runs unless
 * `--apply` is passed, and non-TTY callers must also pass `--force` to
 * skip the confirmation prompt. SDK `deleteBrief` is verified against
 * the Agents tenant.
 */
export const createBriefDeleteCommand = (): Command => {
  const command = new Command("delete")
    .description("Delete a brief. Requires --apply; non-TTY callers must also pass --force.")
    .argument("<briefId>", "Brief UUID")
    .addOption(
      new Option("--force", "Skip TTY confirmation prompt (required for non-TTY agents).")
    );
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (briefId, options) => {
    await withApplyGate(async (opts: { force?: boolean; apply?: boolean; whatIf?: boolean }) => {
      if (!opts.whatIf) {
        const confirmed = await confirmDestructive(
          `Delete brief ${briefId}? This cannot be undone.`,
          opts.force
        );
        if (!confirmed) {
          process.stderr.write("Aborted.\n");
          return;
        }
      }
      await runBriefDelete({ ...opts, briefId });
    })(options);
  });
  return command;
};
