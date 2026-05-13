import { Command } from "commander";
import { runAuditUnusedMedia } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditUnusedMediaCommand = (): Command => {
  const command = new Command("unused-media").description(
    "Find media library items with zero references from content"
  );

  const list = new Command("list").description(
    "List media items that aren't referenced by any content"
  );
  addAuditBaseOptions(list);
  list.option(
    "--media-root <path>",
    "Media library root to scan (default: /sitecore/media library)"
  );
  list.option(
    "--reference-root <path>",
    "Root under which media references are searched (default: /sitecore/content)"
  );
  list.option("--media-limit <count>", "Cap on the number of media items inspected", (v) =>
    parseInt(v, 10)
  );
  list.option(
    "--reference-limit <count>",
    "Cap on the number of reference-side items inspected",
    (v) => parseInt(v, 10)
  );
  list.option("--batch-size <count>", "Aliased GraphQL batch size for field reads", (v) =>
    parseInt(v, 10)
  );
  list.action(async (options) => {
    await runAuditUnusedMedia(options);
  });

  command.addCommand(list);
  return command;
};
