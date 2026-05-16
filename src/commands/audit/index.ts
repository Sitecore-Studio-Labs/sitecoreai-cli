import { Command } from "commander";
import { createAuditAllCommand } from "./all";
import { createAuditAltTextMissingCommand } from "./alt-text-missing";
import { createAuditBaselineCommand } from "./baseline";
import { createAuditBrokenLinksCommand } from "./broken-links";
import { createAuditHeavyTemplatesCommand } from "./heavy-templates";
import { createAuditLargeFieldsCommand } from "./large-fields";
import { createAuditBrokenImagesCommand } from "./broken-images";
import { createAuditEmptyRolesCommand } from "./empty-roles";
import { createAuditHistoryCommand } from "./history";
import { createAuditSuiteCommand } from "./suite";
import { createAuditFallbackDriftCommand } from "./fallback-drift";
import { createAuditMissingMetaCommand } from "./missing-meta";
import { createAuditRoleBloatCommand } from "./role-bloat";
import { createAuditSlugConflictsCommand } from "./slug-conflicts";
import { createAuditStaleUsersCommand } from "./stale-users";
import { createAuditTranslationCoverageCommand } from "./translation-coverage";
import { createAuditDatasourceMissingCommand } from "./datasource-missing";
import { createAuditDeadTemplatesCommand } from "./dead-templates";
import { createAuditDuplicatesCommand } from "./duplicates";
import { createAuditEmptyItemsCommand } from "./empty-items";
import { createAuditEmptyLinksCommand } from "./empty-links";
import { createAuditFindReplaceCommand } from "./find-replace";
import { createAuditLanguageDataCommand } from "./language-data";
import { createAuditOrphansCommand } from "./orphans";
import { createAuditPageDesignOrphansCommand } from "./page-design-orphans";
import { createAuditPersonalizationBrokenCommand } from "./personalization-broken";
import { createAuditReferencesCommand } from "./references";
import { createAuditSiteResidueCommand } from "./site-residue";
import { createAuditStaleContentCommand } from "./stale-content";
import { createAuditStaleWorkflowCommand } from "./stale-workflow";
import { createAuditTemplateDependenciesCommand } from "./template-dependencies";
import { createAuditUnusedMediaCommand } from "./unused-media";

export const createAuditCommand = (): Command => {
  const command = new Command("audit").description(
    "Read-only diagnostics over Sitecore content — links, media, archive, workflow, languages, templates, datasources, duplicates, empty items, page designs, personalization"
  );

  command.addCommand(createAuditAllCommand());
  command.addCommand(createAuditAltTextMissingCommand());
  command.addCommand(createAuditBaselineCommand());
  command.addCommand(createAuditBrokenImagesCommand());
  command.addCommand(createAuditBrokenLinksCommand());
  command.addCommand(createAuditHeavyTemplatesCommand());
  command.addCommand(createAuditLargeFieldsCommand());
  command.addCommand(createAuditMissingMetaCommand());
  command.addCommand(createAuditDatasourceMissingCommand());
  command.addCommand(createAuditDeadTemplatesCommand());
  command.addCommand(createAuditDuplicatesCommand());
  command.addCommand(createAuditEmptyItemsCommand());
  command.addCommand(createAuditEmptyLinksCommand());
  command.addCommand(createAuditEmptyRolesCommand());
  command.addCommand(createAuditFallbackDriftCommand());
  command.addCommand(createAuditFindReplaceCommand());
  command.addCommand(createAuditLanguageDataCommand());
  command.addCommand(createAuditOrphansCommand());
  command.addCommand(createAuditPageDesignOrphansCommand());
  command.addCommand(createAuditPersonalizationBrokenCommand());
  command.addCommand(createAuditReferencesCommand());
  command.addCommand(createAuditRoleBloatCommand());
  command.addCommand(createAuditSiteResidueCommand());
  command.addCommand(createAuditSlugConflictsCommand());
  command.addCommand(createAuditStaleContentCommand());
  command.addCommand(createAuditStaleUsersCommand());
  command.addCommand(createAuditStaleWorkflowCommand());
  command.addCommand(createAuditTemplateDependenciesCommand());
  command.addCommand(createAuditHistoryCommand());
  command.addCommand(createAuditSuiteCommand());
  command.addCommand(createAuditTranslationCoverageCommand());
  command.addCommand(createAuditUnusedMediaCommand());

  command.addHelpText(
    "after",
    [
      "",
      "Audits read master-database state via the Authoring API — findings",
      "reflect master, not what Experience Edge currently serves.",
      "",
      "Audits by theme:",
      "  Links & references   broken-links, empty-links, references,",
      "                       datasource-missing, personalization-broken",
      "  Media & assets       broken-images, alt-text-missing, unused-media,",
      "                       large-fields",
      "  Templates & layout   dead-templates, heavy-templates,",
      "                       template-dependencies, page-design-orphans",
      "  Content health       duplicates, empty-items, orphans, slug-conflicts,",
      "                       stale-content, missing-meta",
      "  Languages            fallback-drift, language-data, translation-coverage",
      "  Workflow & access    stale-workflow, stale-users, role-bloat, empty-roles",
      "  Site residue         site-residue",
      "  Search               find-replace",
      "  Run & manage         all, suite, baseline, history",
      "",
      "Examples (each audit's --help has its full option set):",
      "  $ scai hygiene audit broken-links list --root /sitecore/content/MySite",
      "  $ scai hygiene audit dead-templates list --root /sitecore/templates/Project",
      "  $ scai hygiene audit duplicates list --min-group-size 3 --json",
      "  $ scai hygiene audit all                       # run every audit",
      "",
    ].join("\n")
  );

  return command;
};
