import { Command } from "commander";
import { runAuditTemplateDependencies } from "@/hygiene/tasks/audit-template-dependencies";
import { addAuditBaseOptions } from "./shared";

export const createAuditTemplateDependenciesCommand = (): Command => {
  const command = new Command("template-dependencies").description(
    "List every item that references a given template — primary template, base template, insert options, or branch source"
  );

  const list = new Command("list").description("List inbound references to a template");
  addAuditBaseOptions(list);
  list.requiredOption(
    "--template-id <guid>",
    "Template item ID to find references for (any GUID form)"
  );
  list.option(
    "--skip <kind>",
    "Skip a reference kind: primary-template, base-template, insert-options, branch-source, datasource-template. Repeat or comma-separate.",
    (v: string, prev: string[] = []) =>
      prev.concat(
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    [] as string[]
  );
  list.action(async (options) => {
    await runAuditTemplateDependencies(options);
  });

  command.addCommand(list);
  return command;
};
