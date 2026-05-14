import { Command } from "commander";
import { createBrandReviewCommand } from "./review";

/**
 * `scai brand` — Sitecore AI Skills brand surface (Brand Management
 * + Brand Review). The CLI verbs here drive the same library
 * primitives exposed at `@sitecoreai-labs/cli/brand`. See
 * [[project-scai-ai-skills-credential-model]] for the org-scoped
 * credential model.
 */
export const createBrandCommand = (): Command => {
  const command = new Command("brand").description(
    "Sitecore AI Skills brand surface (Brand Management + Brand Review). Provision the credential with `scai login ai-skills`."
  );

  command.addCommand(createBrandReviewCommand());

  command.addHelpText(
    "after",
    "\nSetup:\n" +
      "  1. Create an AI APIs key in Cloud Portal → Stream → Admin → AI APIs keys\n" +
      "  2. $ scai login ai-skills -n <env>\n" +
      "  3. $ scai brand review --glob 'content/**/*.md' --kit <kitId> --threshold 4\n"
  );

  return command;
};
