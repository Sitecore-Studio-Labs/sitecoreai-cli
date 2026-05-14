import { Command } from "commander";
import { createAuditAllCommand } from "./all";
import { createAuditAltTextMissingCommand } from "./alt-text-missing";
import { createAuditBaselineCommand } from "./baseline";
import { createAuditBrokenLinksCommand } from "./broken-links";
import { createAuditHeavyTemplatesCommand } from "./heavy-templates";
import { createAuditLargeFieldsCommand } from "./large-fields";
import { createAuditEmptyRolesCommand } from "./empty-roles";
import { createAuditMissingMetaCommand } from "./missing-meta";
import { createAuditRoleBloatCommand } from "./role-bloat";
import { createAuditStaleUsersCommand } from "./stale-users";
import { createAuditDatasourceMissingCommand } from "./datasource-missing";
import { createAuditDeadTemplatesCommand } from "./dead-templates";
import { createAuditDuplicatesCommand } from "./duplicates";
import { createAuditEmptyItemsCommand } from "./empty-items";
import { createAuditFindReplaceCommand } from "./find-replace";
import { createAuditLanguageDataCommand } from "./language-data";
import { createAuditOrphansCommand } from "./orphans";
import { createAuditPageDesignOrphansCommand } from "./page-design-orphans";
import { createAuditPersonalizationBrokenCommand } from "./personalization-broken";
import { createAuditStaleContentCommand } from "./stale-content";
import { createAuditStaleWorkflowCommand } from "./stale-workflow";
import { createAuditUnusedMediaCommand } from "./unused-media";

export const createAuditCommand = (): Command => {
  const command = new Command("audit").description(
    "Read-only diagnostics over Sitecore content — links, media, archive, workflow, languages, templates, datasources, duplicates, empty items, page designs, personalization"
  );

  command.addCommand(createAuditAllCommand());
  command.addCommand(createAuditAltTextMissingCommand());
  command.addCommand(createAuditBaselineCommand());
  command.addCommand(createAuditBrokenLinksCommand());
  command.addCommand(createAuditHeavyTemplatesCommand());
  command.addCommand(createAuditLargeFieldsCommand());
  command.addCommand(createAuditMissingMetaCommand());
  command.addCommand(createAuditDatasourceMissingCommand());
  command.addCommand(createAuditDeadTemplatesCommand());
  command.addCommand(createAuditDuplicatesCommand());
  command.addCommand(createAuditEmptyItemsCommand());
  command.addCommand(createAuditEmptyRolesCommand());
  command.addCommand(createAuditFindReplaceCommand());
  command.addCommand(createAuditLanguageDataCommand());
  command.addCommand(createAuditOrphansCommand());
  command.addCommand(createAuditPageDesignOrphansCommand());
  command.addCommand(createAuditPersonalizationBrokenCommand());
  command.addCommand(createAuditRoleBloatCommand());
  command.addCommand(createAuditStaleContentCommand());
  command.addCommand(createAuditStaleUsersCommand());
  command.addCommand(createAuditStaleWorkflowCommand());
  command.addCommand(createAuditUnusedMediaCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai audit broken-links list --root /sitecore/content/MySite\n" +
      "  $ scai audit dead-templates list --root /sitecore/templates/Project\n" +
      "  $ scai audit duplicates list --min-group-size 3 --json\n" +
      "  $ scai audit datasource-missing list\n" +
      "  $ scai audit empty-items list --language en\n" +
      "  $ scai audit page-design-orphans list\n" +
      "  $ scai audit personalization-broken list\n" +
      "  $ scai audit orphans list\n" +
      "  $ scai audit stale-workflow list --days 60\n" +
      "  $ scai audit unused-media list --json\n" +
      "  $ scai audit language-data list --languages en,fr\n"
  );

  return command;
};
