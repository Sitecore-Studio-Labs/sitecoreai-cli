import { Command } from "commander";
import { runAuditReferences } from "@/hygiene/tasks/audit-references";
import { addAuditBaseOptions } from "./shared";

export const createAuditReferencesCommand = (): Command => {
  const command = new Command("references").description(
    "Find every item with a field that references a target item — generic inbound-reference scan"
  );

  const list = new Command("list").description("List inbound references to an item");
  addAuditBaseOptions(list);
  list.requiredOption("--to <guid>", "Item ID to find references for (any GUID form)");
  list.option("--root <path>", "Content root to scan (default: /sitecore/content)");
  list.option(
    "--fields <name>",
    "Restrict scan to these field names. Repeat or comma-separate.",
    (v: string, prev: string[] = []) =>
      prev.concat(
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    [] as string[]
  );
  list.option(
    "--exclude-system-fields",
    "Skip `__`-prefixed system fields. Off by default — system fields (Renderings, Layout, etc.) carry most cross-item references."
  );
  list.action(async (options) => {
    await runAuditReferences({
      ...options,
      includeSystemFields: !options.excludeSystemFields,
    });
  });

  command.addCommand(list);
  return command;
};
