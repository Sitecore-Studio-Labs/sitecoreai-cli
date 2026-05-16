import { Command } from "commander";
import { createBrandDocsCommand } from "./docs";
import { createBrandKitsCommand } from "./kits";
import { createBrandEnrichCommand, createBrandIngestCommand } from "./ingest-enrich";
import { createBrandReviewCommand } from "./review";
import { createBrandSeedCommand } from "./seed";
import { createBrandSyncCommand } from "./sync";

/**
 * `scai brand` — Sitecore brand surface (Brand Management
 * + Brand Review). The CLI verbs here drive the same library
 * primitives exposed at `@sitecoreai-labs/cli/brand`. See
 * [[project-scai-ai-skills-credential-model]] for the org-scoped
 * credential model.
 */
export const createBrandCommand = (): Command => {
  const command = new Command("brand").description(
    "Sitecore brand surface (Brand Management + Brand Review). Provision the credential with `scai setup login brand`."
  );

  command.addCommand(createBrandKitsCommand());
  command.addCommand(createBrandDocsCommand());
  command.addCommand(createBrandIngestCommand());
  command.addCommand(createBrandEnrichCommand());
  command.addCommand(createBrandSeedCommand());
  command.addCommand(createBrandReviewCommand());
  command.addCommand(createBrandSyncCommand());

  command.addHelpText(
    "after",
    "\nSetup:\n" +
      "  1. Create an AI APIs key in Cloud Portal → Stream → Admin → AI APIs keys\n" +
      "  2. $ scai setup login brand -n <env>\n" +
      "  3. $ scai brand review --glob 'content/**/*.md' --kit <kitId> --threshold 4\n"
  );

  return command;
};
