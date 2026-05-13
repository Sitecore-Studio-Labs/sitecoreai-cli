import { Command } from "commander";
import { createAuditBrokenLinksCommand } from "./broken-links";
import { createAuditLanguageDataCommand } from "./language-data";
import { createAuditOrphansCommand } from "./orphans";
import { createAuditStaleWorkflowCommand } from "./stale-workflow";
import { createAuditUnusedMediaCommand } from "./unused-media";

export const createAuditCommand = (): Command => {
  const command = new Command("audit").description(
    "Read-only diagnostics over Sitecore content — links, media, archive, workflow, languages"
  );

  command.addCommand(createAuditBrokenLinksCommand());
  command.addCommand(createAuditLanguageDataCommand());
  command.addCommand(createAuditOrphansCommand());
  command.addCommand(createAuditStaleWorkflowCommand());
  command.addCommand(createAuditUnusedMediaCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai audit broken-links list --root /sitecore/content/MySite\n" +
      "  $ scai audit unused-media list --json\n" +
      "  $ scai audit orphans list\n" +
      "  $ scai audit stale-workflow list --days 60\n" +
      "  $ scai audit language-data list --languages en,fr\n"
  );

  return command;
};
