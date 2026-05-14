import { Command } from "commander";
import { runAuditBrokenImages } from "@/hygiene/tasks";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditBrokenImagesCommand = (): Command => {
  const command = new Command("broken-images").description(
    "Find <img src> URLs in RichText fields that fail HTTP HEAD (404, timeout, network)"
  );
  const list = new Command("list").description(
    "Probe each <img> URL with HEAD and report non-2xx / timeouts"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language");
  list.option("--request-timeout-ms <ms>", "Per-URL HEAD timeout in ms (default 5000)", (v) =>
    parseInt(v, 10)
  );
  list.option("--url-limit <count>", "Max distinct URLs probed in one run (default 500)", (v) =>
    parseInt(v, 10)
  );
  list.option(
    "--exclude-domains <hosts>",
    "Comma-separated hostnames to skip (e.g. third-party CDNs you can't reach)",
    collectList,
    []
  );
  list.addHelpText(
    "after",
    "\nNote: makes external HTTP requests. Excluded from `audit all` by default;\n" +
      "include with `--include broken-images` when running explicitly.\n"
  );
  list.action(async (options) => {
    await runAuditBrokenImages(options);
  });
  command.addCommand(list);
  return command;
};
