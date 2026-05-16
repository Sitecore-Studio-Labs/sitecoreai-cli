import { Command } from "commander";
import { runCleanupPublish } from "@/hygiene/tasks/cleanup/publish";
import { collectList, withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupPublishCommand = (): Command => {
  const command = new Command("publish").description(
    "Bulk-publish a curated list of items, or every item under a root"
  );

  const dispatch = new Command("dispatch").description(
    "Dispatch a single publish job covering the supplied scope"
  );
  addCleanupBaseOptions(dispatch);
  dispatch.option(
    "--items <ids>",
    "Comma-separated item IDs or content-tree paths to publish (mutually exclusive with --root)",
    collectList,
    []
  );
  dispatch.option(
    "--root <path>",
    "Content-tree root — publish every descendant (mutually exclusive with --items)"
  );
  dispatch.option(
    "--languages <codes>",
    "Comma-separated language codes (default: tenant primary)",
    collectList,
    []
  );
  dispatch.option("--target <name>", "Publish target (e.g. web). Default: all configured");
  dispatch.option("--republish", "Re-publish unchanged items (default: incremental)");
  dispatch.option(
    "--max-publishes <count>",
    "Maximum number of items to publish per run (default: 1000)",
    (v) => parseInt(v, 10)
  );
  dispatch.option(
    "--poll-timeout-ms <ms>",
    "Poll publishingStatus until completion or this timeout (default: 0 = fire-and-return)",
    (v) => parseInt(v, 10)
  );
  dispatch.option(
    "--poll-interval-ms <ms>",
    "Polling cadence in ms when --poll-timeout-ms > 0 (default: 2000)",
    (v) => parseInt(v, 10)
  );
  dispatch.action(withApplyGate(runCleanupPublish));

  command.addCommand(dispatch);
  return command;
};
