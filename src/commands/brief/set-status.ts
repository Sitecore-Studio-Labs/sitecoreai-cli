import { Argument, Command } from "commander";
import { runBriefSetStatus } from "@/brief/tasks";
import type { BriefStatus } from "@/brief/api/schema";
import {
  addApplyOption,
  addConfigOption,
  addOrgScopeOptions,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

const BRIEF_STATUSES: BriefStatus[] = ["Draft", "InReview", "Approved", "Canceled", "Archived"];

/**
 * `scai ops brief set-status <briefId> <status>` — move a brief through its
 * workflow. A brief must be out of `Draft` (e.g. `InReview` or
 * `Approved`) before it can be linked to a campaign.
 *
 * Status values are the API wire form: `InReview` carries the "In
 * Review" UI label. Write — dry-runs unless `--apply` is passed.
 */
export const createBriefSetStatusCommand = (): Command => {
  const command = new Command("set-status")
    .description("Set a brief's workflow status (Draft, InReview, Approved, Canceled, Archived).")
    .argument("<briefId>", "Brief UUID")
    .addArgument(new Argument("<status>", "New status — API wire form").choices(BRIEF_STATUSES));
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (briefId: string, status: BriefStatus, options) => {
    await withApplyGate(async (opts: { apply?: boolean; whatIf?: boolean }) => {
      await runBriefSetStatus({ ...opts, briefId, status });
    })(options);
  });
  return command;
};
